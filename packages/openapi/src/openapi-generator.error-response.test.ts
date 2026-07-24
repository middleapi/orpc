import { oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator error response', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  it('omits error responses when the procedure defines no errors', async () => {
    const doc = await generator.generate({
      ping: oc.meta(openapi({})).output(z.object({ ok: z.boolean() })),
    })

    expect(doc.paths?.['/ping']?.post?.responses).toEqual({
      200: expect.any(Object),
    })
    expect(doc.components?.schemas).toBeUndefined()
  })

  it('reuses error components from a previously generated base document', async () => {
    const router = {
      ping: oc.meta(openapi({})).errors({ NOT_FOUND: {} }).output(z.object({ ok: z.boolean() })),
    }

    const first = await generator.generate(router)
    const second = await generator.generate(router, {
      base: { components: first.components },
    })

    expect(Object.keys(second.components?.schemas ?? {}).sort()).toEqual([
      'NotFound',
      'UndefinedError',
    ])
    expect((second.paths?.['/ping']?.post?.responses?.[404] as any)?.content['application/json'].schema.oneOf).toEqual([
      { $ref: '#/components/schemas/NotFound' },
      { $ref: '#/components/schemas/UndefinedError' },
    ])
  })

  it('hoists error data component schemas and reuses them across procedures', async () => {
    const conflictData = () => testSchema({
      type: 'object',
      properties: { info: { $ref: '#/$defs/ConflictData' } },
      required: ['info'],
      $defs: {
        ConflictData: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
      },
    })

    const doc = await generator.generate({
      a: oc.meta(openapi({})).errors({ CONFLICT: { data: conflictData() } }),
      b: oc.meta(openapi({})).errors({ CONFLICT: { data: conflictData() } }),
    })

    const errorRefs = (path: `/${string}`) => (doc.paths?.[path]?.post?.responses?.[409] as any)
      ?.content['application/json']
      .schema
      .oneOf

    expect(errorRefs('/a')).toEqual([
      { $ref: '#/components/schemas/Conflict' },
      { $ref: '#/components/schemas/UndefinedError' },
    ])
    expect(errorRefs('/b')).toEqual(errorRefs('/a'))

    expect(doc.components?.schemas?.Conflict).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        data: expect.objectContaining({
          properties: {
            info: { $ref: '#/components/schemas/ConflictData' },
          },
        }),
      }),
    }))
    expect(doc.components?.schemas?.ConflictData).toEqual({
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    })
  })

  it('hoists each defined error into components named after its code', async () => {
    const doc = await generator.generate({
      ping: oc
        .meta(openapi({}))
        .errors({
          'BAD_REQUEST': { data: z.object({ field: z.string() }) },
          'BAD_REQUEST_2': { message: 'Second bad request' },
          'custom-timeout': {},
        })
        .output(z.object({ ok: z.boolean() })),
    }, {
      errorStatusMap: {
        'BAD_REQUEST': 400,
        'BAD_REQUEST_2': 400,
        'custom-timeout': 408,
      },
    })

    expect(doc.paths?.['/ping']?.post?.responses?.[400]).toEqual({
      description: 'Second bad request',
      content: {
        'application/json': {
          schema: {
            oneOf: [
              { $ref: '#/components/schemas/BadRequest' },
              { $ref: '#/components/schemas/BadRequest2' },
              { $ref: '#/components/schemas/UndefinedError' },
            ],
          },
        },
      },
    })

    expect(doc.paths?.['/ping']?.post?.responses?.[408]).toEqual({
      description: '408',
      content: {
        'application/json': {
          schema: {
            oneOf: [
              { $ref: '#/components/schemas/CustomTimeout' },
              { $ref: '#/components/schemas/UndefinedError' },
            ],
          },
        },
      },
    })

    expect(Object.keys(doc.components?.schemas ?? {}).sort()).toEqual([
      'BadRequest',
      'BadRequest2',
      'CustomTimeout',
      'UndefinedError',
    ])
  })

  it('builds the default error body schema with code, status, message, and data', async () => {
    const doc = await generator.generate({
      ping: oc
        .meta(openapi({}))
        .errors({
          CONFLICT: {
            message: 'Planet already exists',
            data: z.object({ reason: z.string() }),
          },
        })
        .output(z.object({ ok: z.boolean() })),
    })

    expect(doc.paths?.['/ping']?.post?.responses?.[409]).toEqual({
      description: 'Planet already exists',
      content: {
        'application/json': {
          schema: {
            oneOf: [
              { $ref: '#/components/schemas/Conflict' },
              { $ref: '#/components/schemas/UndefinedError' },
            ],
          },
        },
      },
    })

    expect(doc.components?.schemas?.Conflict).toEqual({
      type: 'object',
      properties: {
        defined: { const: true },
        inferable: { type: 'boolean' },
        code: { const: 'CONFLICT' },
        status: { const: 409 },
        message: { type: 'string', default: 'Planet already exists' },
        data: expect.objectContaining({
          type: 'object',
          properties: {
            reason: expect.objectContaining({ type: 'string' }),
          },
          required: ['reason'],
        }),
      },
      required: ['defined', 'inferable', 'code', 'status', 'message', 'data'],
    })

    expect(doc.components?.schemas?.UndefinedError).toEqual({
      type: 'object',
      properties: {
        defined: { const: false },
        inferable: { type: 'boolean' },
        code: { type: 'string' },
        status: { type: 'number' },
        message: { type: 'string' },
        data: {},
      },
      required: ['defined', 'inferable', 'code', 'status', 'message'],
    })
  })

  it('reuses equal error components across procedures and postfixes conflicting ones', async () => {
    const doc = await generator.generate({
      a: oc.meta(openapi({})).errors({ NOT_FOUND: {} }),
      b: oc.meta(openapi({})).errors({ NOT_FOUND: {} }),
      c: oc.meta(openapi({})).errors({ NOT_FOUND: { data: z.object({ hint: z.string() }) } }),
    })

    const errorRefs = (path: `/${string}`) => (doc.paths?.[path]?.post?.responses?.[404] as any)
      ?.content['application/json']
      .schema
      .oneOf

    expect(errorRefs('/a')).toEqual([
      { $ref: '#/components/schemas/NotFound' },
      { $ref: '#/components/schemas/UndefinedError' },
    ])
    expect(errorRefs('/b')).toEqual([
      { $ref: '#/components/schemas/NotFound' },
      { $ref: '#/components/schemas/UndefinedError' },
    ])
    expect(errorRefs('/c')).toEqual([
      { $ref: '#/components/schemas/NotFound2' },
      { $ref: '#/components/schemas/UndefinedError' },
    ])

    expect(doc.components?.schemas?.NotFound).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        code: { const: 'NOT_FOUND' },
      }),
      required: ['defined', 'inferable', 'code', 'status', 'message'],
    }))
    expect(doc.components?.schemas?.NotFound2).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        code: { const: 'NOT_FOUND' },
        data: expect.objectContaining({
          properties: {
            hint: expect.objectContaining({ type: 'string' }),
          },
        }),
      }),
      required: ['defined', 'inferable', 'code', 'status', 'message', 'data'],
    }))
  })

  it('groups defined errors by status and allows overriding the error body schema', async () => {
    const generator = new OpenAPIGenerator({
      converters: [zodJsonSchemaConverter],
    })

    const customErrorResponseBodySchema = vi.fn((definedErrors, status) => {
      if (status === 400) {
        return {
          type: 'object' as const,
          description: 'custom-400',
        }
      }

      return undefined
    })

    const doc = await generator.generate({
      ping: oc
        .meta(openapi({}))
        .errors({
          BAD_REQUEST: {
            data: z.object({ field: z.string() }),
          },
          BAD_REQUEST_2: {
            message: 'Second bad request',
          },
          NOT_FOUND: {},
        })
        .output(z.object({ ok: z.boolean() })),
    }, {
      errorStatusMap: {
        BAD_REQUEST: 400,
        BAD_REQUEST_2: 400,
        NOT_FOUND: 404,
      },
      customErrorResponseBodySchema,
    })

    expect(customErrorResponseBodySchema).toHaveBeenCalledTimes(2)
    expect(customErrorResponseBodySchema).toHaveBeenNthCalledWith(1, [
      {
        code: 'BAD_REQUEST',
        dataOptional: false,
        dataJsonSchema: expect.any(Object),
      },
      {
        code: 'BAD_REQUEST_2',
        defaultMessage: 'Second bad request',
        dataOptional: true,
        dataJsonSchema: expect.any(Object),
      },
    ], 400)
    expect(customErrorResponseBodySchema).toHaveBeenNthCalledWith(2, [
      {
        code: 'NOT_FOUND',
        dataOptional: true,
        dataJsonSchema: expect.any(Object),
      },
    ], 404)

    expect(doc.paths?.['/ping']).toEqual({
      post: expect.objectContaining({
        responses: {
          200: expect.any(Object),
          400: {
            description: 'Second bad request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'custom-400',
                },
              },
            },
          },
          404: {
            description: '404',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/NotFound' },
                    { $ref: '#/components/schemas/UndefinedError' },
                  ],
                },
              },
            },
          },
        },
      }),
    })

    expect(doc.components?.schemas).toEqual({
      NotFound: expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          code: { const: 'NOT_FOUND' },
          status: { const: 404 },
        }),
      }),
      UndefinedError: {
        type: 'object',
        properties: {
          defined: { const: false },
          inferable: { type: 'boolean' },
          code: { type: 'string' },
          status: { type: 'number' },
          message: { type: 'string' },
          data: {},
        },
        required: ['defined', 'inferable', 'code', 'status', 'message'],
      },
    })
  })
})
