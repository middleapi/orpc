import { oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator request query', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  it('omits parameters and request body when a GET procedure has no input schema', async () => {
    const doc = await generator.generate({
      listPlanets: oc.meta(openapi({ method: 'GET' })),
    })

    expect(doc.paths?.['/listPlanets']?.get).toBeDefined()
    expect(doc.paths?.['/listPlanets']?.get?.parameters).toBeUndefined()
    expect(doc.paths?.['/listPlanets']?.get?.requestBody).toBeUndefined()
  })

  it('maps compact GET query parameters', async () => {
    const doc = await generator.generate({
      search: oc
        .meta(openapi({
          method: 'GET',
          path: '/planets/{id}',
          queryStyles: {
            filter: 'primitive',
            tags: 'array',
          },
        }))
        .input(z.object({
          id: z.string(),
          filter: z.string(),
          tags: z.array(z.string()),
          meta: z.object({ published: z.boolean() }).optional(),
        })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      get: expect.objectContaining({
        parameters: expect.arrayContaining([
          {
            name: 'filter',
            in: 'query',
            required: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'string' }),
          },
          {
            name: 'tags',
            in: 'query',
            required: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'array' }),
          },
          {
            name: 'meta',
            in: 'query',
            style: 'deepObject',
            explode: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'object' }),
          },
        ]),
      }),
    })
  })

  it('maps detailed query parameters', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({
          method: 'POST',
          path: '/planets/{id}',
          inputStructure: 'detailed',
        }))
        .input(z.object({
          params: z.object({ id: z.string() }),
          query: z.object({ expand: z.boolean().optional() }),
        }))
        .output(z.object({ ok: z.boolean() })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      post: expect.objectContaining({
        parameters: expect.arrayContaining([
          {
            name: 'expand',
            in: 'query',
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'boolean' }),
          },
        ]),
      }),
    })
  })

  it('maps query parameters from any schema via custom converters', async () => {
    const doc = await generator.generate({
      search: oc
        .meta(openapi({ method: 'GET' }))
        .input(testSchema({
          type: 'object',
          properties: {
            keyword: { type: 'string' },
            limit: { type: 'integer' },
          },
          required: ['keyword'],
        })),
    })

    expect(doc.paths?.['/search']).toEqual({
      get: expect.objectContaining({
        parameters: [
          {
            name: 'keyword',
            in: 'query',
            required: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            allowEmptyValue: true,
            allowReserved: true,
            schema: { type: 'integer' },
          },
        ],
      }),
    })
  })

  it('maps default query styles as primitive/array and fallback to deepObject in compact input structure mode', async () => {
    const doc = await generator.generate({
      search: oc
        .meta(openapi({
          method: 'GET',
        }))
        .input(z.object({
          primitive: z.string(),
          arrayable: z.array(z.string()).or(z.string()),
          array: z.array(z.string()),
          object: z.object({ nested: z.string() }),
        }))
        .output(z.object({ ok: z.boolean() })),
    })

    expect(doc.paths?.['/search']).toEqual({
      get: expect.objectContaining({
        parameters: expect.arrayContaining([
          {
            name: 'primitive',
            in: 'query',
            required: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'string' }),
          },
          {
            name: 'arrayable',
            in: 'query',
            required: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ anyOf: expect.any(Array) }),
          },
          {
            name: 'array',
            in: 'query',
            required: true,
            style: 'deepObject',
            explode: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'array' }),
          },
          {
            name: 'object',
            in: 'query',
            required: true,
            style: 'deepObject',
            explode: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'object' }),
          },
        ]),
      }),
    })
  })

  it('maps default query styles as primitive and fallback to deepObject in detailed input structure mode', async () => {
    const doc = await generator.generate({
      search: oc
        .meta(openapi({
          method: 'GET',
          inputStructure: 'detailed',
        }))
        .input(z.object({
          query: z.object({
            primitive: z.string(),
            array: z.array(z.string()),
            object: z.object({ nested: z.string() }),
          }),
        }))
        .output(z.object({ ok: z.boolean() })),
    })

    expect(doc.paths?.['/search']).toEqual({
      get: expect.objectContaining({
        parameters: expect.arrayContaining([
          {
            name: 'primitive',
            in: 'query',
            required: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'string' }),
          },
          {
            name: 'array',
            in: 'query',
            required: true,
            style: 'deepObject',
            explode: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'array' }),
          },
          {
            name: 'object',
            in: 'query',
            required: true,
            style: 'deepObject',
            explode: true,
            allowEmptyValue: true,
            allowReserved: true,
            schema: expect.objectContaining({ type: 'object' }),
          },
        ]),
      }),
    })
  })

  describe.each(['compact', 'detailed'] as const)('all supported query styles in %s input structure mode', (inputStructure) => {
    it('maps each style to the correct OpenAPI parameter encoding', async () => {
      const fields = z.object({
        primitive: z.string(),
        array: z.array(z.string()),
        commaArray: z.array(z.string()),
        commaObject: z.object({ a: z.string(), b: z.string() }),
        spaceArray: z.array(z.string()),
        spaceObject: z.object({ a: z.string(), b: z.string() }),
        pipeArray: z.array(z.string()),
        pipeObject: z.object({ a: z.string(), b: z.string() }),
        json: z.object({ enabled: z.boolean() }),
        bracketObject: z.object({ nested: z.string() }),
      })

      const doc = await generator.generate({
        search: oc
          .meta(openapi({
            method: 'GET',
            inputStructure,
            queryStyles: {
              primitive: 'primitive',
              array: 'array',
              commaArray: 'comma-delimited-array',
              commaObject: 'comma-delimited-object',
              spaceArray: 'space-delimited-array',
              spaceObject: 'space-delimited-object',
              pipeArray: 'pipe-delimited-array',
              pipeObject: 'pipe-delimited-object',
              json: 'json',
              bracketObject: undefined,
            },
          }))
          .input(inputStructure === 'compact' ? fields : z.object({ query: fields }))
          .output(z.object({ ok: z.boolean() })),
      })

      expect(doc.paths?.['/search']).toEqual({
        get: expect.objectContaining({
          parameters: expect.arrayContaining([
            {
              name: 'primitive',
              in: 'query',
              required: true,
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'array',
              in: 'query',
              required: true,
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'array' }),
            },
            {
              name: 'commaArray',
              in: 'query',
              required: true,
              explode: false,
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'array' }),
            },
            {
              name: 'commaObject',
              in: 'query',
              required: true,
              explode: false,
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'object' }),
            },
            {
              name: 'spaceArray',
              in: 'query',
              required: true,
              style: 'spaceDelimited',
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'array' }),
            },
            {
              name: 'spaceObject',
              in: 'query',
              required: true,
              style: 'spaceDelimited',
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'object' }),
            },
            {
              name: 'pipeArray',
              in: 'query',
              required: true,
              style: 'pipeDelimited',
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'array' }),
            },
            {
              name: 'pipeObject',
              in: 'query',
              required: true,
              style: 'pipeDelimited',
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'object' }),
            },
            {
              name: 'json',
              in: 'query',
              required: true,
              allowEmptyValue: true,
              allowReserved: true,
              content: {
                'application/json': {
                  schema: expect.objectContaining({ type: 'object' }),
                },
              },
            },
            {
              name: 'bracketObject',
              in: 'query',
              required: true,
              style: 'deepObject',
              explode: true,
              allowEmptyValue: true,
              allowReserved: true,
              schema: expect.objectContaining({ type: 'object' }),
            },
          ]),
        }),
      })
    })
  })

  it.each([
    {
      name: 'GET input with a non-object schema',
      procedure: oc.meta(openapi({ method: 'GET' })).input(z.string()),
      message: 'Procedure at path "test" uses method "GET" but its input schema is not an object.',
    },
  ])('throws when $name', async ({ procedure, message }) => {
    await expect(generator.generate({ test: procedure })).rejects.toThrow(message)
  })
})
