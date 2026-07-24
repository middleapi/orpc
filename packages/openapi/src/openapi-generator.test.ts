import { oc } from '@orpc/contract'
import * as arktype from 'arktype'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator, OpenAPIGeneratorError } from './openapi-generator'

describe('openAPIGenerator basic & options', () => {
  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

  it('starts from the default base document', async () => {
    await expect(generator.generate({})).resolves.toEqual({
      openapi: '3.1.2',
      info: {
        title: 'API Reference',
        version: '0.0.0',
      },
    })
  })

  it('merges the provided base document and serialize the result', async () => {
    const serializer = {
      serialize: vi.fn(document => document),
      deserialize: vi.fn(document => document),
    }

    const generator = new OpenAPIGenerator({ serializer, converters: [zodJsonSchemaConverter] })

    const doc = await generator.generate({}, {
      base: {
        info: {
          title: 'Planet API',
          version: '1.2.3',
        },
        servers: [{ url: 'https://api.example.com' }],
      },
    })

    expect(serializer.serialize).toHaveBeenCalledWith({
      openapi: '3.1.2',
      info: {
        title: 'Planet API',
        version: '1.2.3',
      },
      servers: [{ url: 'https://api.example.com' }],
    }, {
      asFormData: false,
      useFormDataForBlobFields: false,
    })

    expect(doc).toEqual({
      openapi: '3.1.2',
      info: {
        title: 'Planet API',
        version: '1.2.3',
      },
      servers: [{ url: 'https://api.example.com' }],
    })
  })

  it('does not mutate the provided base document', async () => {
    const base = {
      info: { title: 'Planet API', version: '1.2.3' },
      components: {
        schemas: {
          Existing: { type: 'string' } as any,
        },
      },
    }
    const snapshot = structuredClone(base)

    const doc = await generator.generate({
      planet: oc.input(z.object({ planet: z.object({ id: z.string() }).meta({ id: 'Planet' }) })),
    }, { base })

    expect(doc.components?.schemas).toEqual({
      Existing: { type: 'string' },
      Planet: expect.any(Object),
    })
    expect(base).toEqual(snapshot)
  })

  it('invokes filter with the walked path and excludes filtered procedures', async () => {
    const publicProcedure = oc.meta(openapi({ method: 'GET' }))
    const privateProcedure = oc.meta(openapi({ method: 'GET' }))

    const filter = vi.fn((procedure, path) => procedure !== privateProcedure && path.join('.') !== 'admin.private')

    const doc = await generator.generate({
      public: publicProcedure,
      admin: {
        private: privateProcedure,
      },
    }, {
      filter,
    })

    expect(filter).toHaveBeenCalledTimes(2)
    expect(filter).toHaveBeenNthCalledWith(1, publicProcedure, ['public'])
    expect(filter).toHaveBeenNthCalledWith(2, privateProcedure, ['admin', 'private'])

    expect(doc.paths).toEqual({
      '/public': {
        get: expect.any(Object),
      },
    })
  })

  it('fallback to StandardJsonSchemaConverter', async () => {
    const condition = vi.fn(() => false)
    const generator = new OpenAPIGenerator({ converters: [{ condition, convert: vi.fn() }] })

    const procedure = oc.input(arktype.type({ name: 'string' }))

    const spec = await generator.generate(procedure)

    // ensure it prioritizes the provided converters
    expect(condition).toHaveBeenCalledTimes(2)
    expect(spec.paths?.['/']).toEqual({
      post: expect.objectContaining({
        requestBody: expect.objectContaining({
          content: {
            'application/json': expect.objectContaining({
              schema: {
                properties: {
                  name: {
                    type: 'string',
                  },
                },
                required: ['name'],
                type: 'object',
              },
            }),
          },
        }),
      }),
    })
  })

  it('supports arbitrary schemas through custom converters', async () => {
    const generator = new OpenAPIGenerator({ converters: [testSchemaConverter] })

    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ method: 'POST', path: '/planets' }))
        .input(testSchema({
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        }))
        .output(testSchema({
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        })),
    })

    expect(doc.paths?.['/planets']?.post).toEqual(expect.objectContaining({
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
      responses: {
        200: {
          description: 'OK',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
              },
            },
          },
        },
      },
    }))
  })

  it('converts inputs with the "input" direction and outputs with the "output" direction', async () => {
    const generator = new OpenAPIGenerator({ converters: [testSchemaConverter] })

    const directionalSchema = () => testSchema(
      { type: 'object', properties: { raw: { type: 'string' } }, required: ['raw'] },
      { output: { type: 'object', properties: { parsed: { type: 'number' } }, required: ['parsed'] } },
    )

    const doc = await generator.generate({
      transform: oc
        .input(directionalSchema())
        .output(directionalSchema()),
    })

    expect(doc.paths?.['/transform']?.post).toEqual(expect.objectContaining({
      requestBody: expect.objectContaining({
        content: {
          'application/json': {
            schema: expect.objectContaining({
              properties: { raw: { type: 'string' } },
            }),
          },
        },
      }),
      responses: {
        200: expect.objectContaining({
          content: {
            'application/json': {
              schema: expect.objectContaining({
                properties: { parsed: { type: 'number' } },
              }),
            },
          },
        }),
      },
    }))
  })

  it('aggregates all generator errors into a single OpenAPIGeneratorError', async () => {
    const error = await generator.generate({
      first: oc.meta(openapi({ path: '/planets/{id}' })),
      nested: {
        second: oc.meta(openapi({ method: 'GET' })).input(z.string()),
      },
    }).then(
      () => { throw new Error('expected generate to reject') },
      e => e,
    )

    expect(error).toBeInstanceOf(OpenAPIGeneratorError)
    expect(error.message).toContain('procedure at path: first')
    expect(error.message).toContain('procedure at path: nested.second')
  })

  it('rethrows non-generator errors immediately without wrapping', async () => {
    const generator = new OpenAPIGenerator({
      converters: [{
        condition: () => true,
        convert: () => { throw new Error('converter exploded') },
      }],
    })

    const error = await generator.generate({
      ping: oc.input(z.string()),
    }).then(
      () => { throw new Error('expected generate to reject') },
      e => e,
    )

    expect(error).not.toBeInstanceOf(OpenAPIGeneratorError)
    expect(error.message).toBe('converter exploded')
  })
})
