import type { JsonSchemaConverter } from '@orpc/json-schema'
import { asyncIteratorObject, oc } from '@orpc/contract'
import * as arktype from 'arktype'
import z from 'zod'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator', () => {
  const zodJsonSchemaConverter: JsonSchemaConverter = {
    condition: schema => schema?.['~standard'].vendor === 'zod',
    async convert(schema, direction) {
      const jsonSchema = z.toJSONSchema(schema as any, { io: direction })
      const output = await schema?.['~standard'].validate(undefined)
      return [jsonSchema as any, !output?.issues]
    },
  }

  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

  describe('basic & options', () => {
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
  })

  describe('route', () => {
    it('derives the default path, method, and operationId from router segments', async () => {
      const doc = await generator.generate({
        admin: {
          listUsers: oc
            .input(z.object({ page: z.number().optional() }))
            .output(z.object({ users: z.array(z.string()) })),
        },
      })

      expect(doc.paths).toEqual({
        '/admin/listUsers': {
          post: expect.objectContaining({
            operationId: 'admin.listUsers',
            responses: {
              200: expect.any(Object),
            },
          }),
        },
      })
    })

    it('applies explicit metadata and prefixes', async () => {
      const doc = await generator.generate({
        getPlanet: oc
          .meta(openapi({
            method: 'GET',
            prefix: '/api/v2',
            path: '/planets/{id}',
            operationId: 'getPlanetById',
            tags: ['planets'],
            summary: 'Get a planet',
            description: 'Returns a single planet.',
            deprecated: true,
            successStatus: 206,
            successDescription: 'Planet payload',
          }))
          .input(z.object({ id: z.string() })),
      })

      expect(doc.paths?.['/api/v2/planets/{id}']).toEqual({
        get: expect.objectContaining({
          operationId: 'getPlanetById',
          tags: ['planets'],
          summary: 'Get a planet',
          description: 'Returns a single planet.',
          deprecated: true,
          parameters: [
            expect.objectContaining({
              name: 'id',
              in: 'path',
              required: true,
            }),
          ],
          responses: {
            206: expect.objectContaining({
              description: 'Planet payload',
            }),
          },
        }),
      })
    })

    it('can extends spec with openapi.spec function', async () => {
      const doc = await generator.generate({
        getPlanet: oc
          .meta(openapi({
            method: 'GET',
            path: '/planets/{id}',
            spec: current => ({
              ...current,
              'security': [{ bearerAuth: [] }],
              'x-orpc-kind': 'planet-read',
            }),
          }))
          .input(z.object({ id: z.string() })),
      })

      expect(doc.paths?.['/planets/{id}']).toEqual({
        get: expect.objectContaining({
          'operationId': 'getPlanet',
          'security': [{ bearerAuth: [] }],
          'x-orpc-kind': 'planet-read',
          'parameters': [
            expect.objectContaining({
              name: 'id',
              in: 'path',
              required: true,
            }),
          ],
          'responses': {
            200: expect.any(Object),
          },
        }),
      })
    })

    it('can override spec with openapi.spec object', async () => {
      const doc = await generator.generate({
        getPlanet: oc
          .meta(openapi({
            method: 'GET',
            path: '/planets/{id}',
            operationId: 'getPlanetById',
            spec: {
              'operationId': 'custom.getPlanet',
              'security': [{ bearerAuth: [] }],
              'x-orpc-kind': 'planet-read',
            },
          }))
          .input(z.object({ id: z.string() })),
      })

      expect(doc.paths?.['/planets/{id}']).toEqual({
        get: {
          'operationId': 'custom.getPlanet',
          'security': [{ bearerAuth: [] }],
          'x-orpc-kind': 'planet-read',
        },
      })
    })
  })

  describe('request params', () => {
    it('maps compact path params', async () => {
      const doc = await generator.generate({
        search: oc
          .meta(openapi({ method: 'GET', path: '/planets/{id}/{+rest}', prefix: '/{workspaceId}' }))
          .input(z.object({
            workspaceId: z.string(),
            id: z.string(),
            rest: z.string(),
            filter: z.string(),
          })),
      })

      expect(doc.paths?.['/{workspaceId}/planets/{id}/{rest}']).toEqual({
        get: expect.objectContaining({
          parameters: expect.arrayContaining([
            {
              name: 'workspaceId',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'rest',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
          ]),
        }),
      })
    })

    it('maps detailed path params', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets/{id}/{+rest}',
            inputStructure: 'detailed',
            prefix: '/{workspaceId}',
          }))
          .input(z.object({
            params: z.object({ workspaceId: z.string(), id: z.string(), rest: z.string() }),
          })),
      })

      expect(doc.paths?.['/{workspaceId}/planets/{id}/{rest}']).toEqual({
        post: expect.objectContaining({
          parameters: expect.arrayContaining([
            {
              name: 'workspaceId',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'rest',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
          ]),
        }),
      })
    })

    it('maps all supported params styles in compact input structure mode', async () => {
      const doc = await generator.generate({
        readPlanet: oc
          .meta(openapi({
            method: 'GET',
            path: '/planets/{id}/{tags}/{filters}',
            paramsStyles: {
              id: 'primitive',
              tags: 'comma-delimited-array',
              filters: 'comma-delimited-object',
            },
          }))
          .input(z.object({
            id: z.string(),
            tags: z.array(z.string()),
            filters: z.object({ brand: z.string(), size: z.string() }),
          }))
          .output(z.object({ ok: z.boolean() })),
      })

      expect(doc.paths?.['/planets/{id}/{tags}/{filters}']).toEqual({
        get: expect.objectContaining({
          parameters: expect.arrayContaining([
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'tags',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'array' }),
            },
            {
              name: 'filters',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'object' }),
            },
          ]),
        }),
      })
    })

    it('maps all supported params styles in detailed input structure mode', async () => {
      const doc = await generator.generate({
        readPlanet: oc
          .meta(openapi({
            method: 'GET',
            path: '/planets/{id}/{tags}/{filters}',
            inputStructure: 'detailed',
            paramsStyles: {
              id: 'primitive',
              tags: 'comma-delimited-array',
              filters: 'comma-delimited-object',
            },
          }))
          .input(z.object({
            params: z.object({
              id: z.string(),
              tags: z.array(z.string()),
              filters: z.object({ brand: z.string(), size: z.string() }),
            }),
          })),
      })

      expect(doc.paths?.['/planets/{id}/{tags}/{filters}']).toEqual({
        get: expect.objectContaining({
          parameters: expect.arrayContaining([
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
            {
              name: 'tags',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'array' }),
            },
            {
              name: 'filters',
              in: 'path',
              required: true,
              schema: expect.objectContaining({ type: 'object' }),
            },
          ]),
        }),
      })
    })

    it.each([
      {
        name: 'compact input with dynamic params but no input schema',
        procedure: oc.meta(openapi({ path: '/planets/{id}' })),
        message: 'Procedure at path "test" has dynamic path params (id) but its input schema is not an object.',
      },
      {
        name: 'compact input with dynamic params but non-object input schema',
        procedure: oc.meta(openapi({ path: '/planets/{id}' })).input(z.string()),
        message: 'Procedure at path "test" has dynamic path params (id) but its input schema is not an object.',
      },
      {
        name: 'compact input with optional dynamic params',
        procedure: oc.meta(openapi({ path: '/planets/{id}' })).input(z.object({
          id: z.string().optional(),
          value: z.string().optional(),
        })),
        message: 'Procedure at path "test" has dynamic param "id" marked as optional in its input schema, but path params must always be required in OpenAPI',
      },
      {
        name: 'detailed input with optional dynamic params',
        procedure: oc.meta(openapi({ inputStructure: 'detailed', path: '/{id}' })).input(z.object({
          params: z.object({ id: z.string().optional() }),
        })),
        message: 'Procedure at path "test" has dynamic param "id" marked as optional in its input schema, but path params must always be required in OpenAPI',
      },
    ])('throws when $name', async ({ procedure, message }) => {
      await expect(generator.generate({ test: procedure })).rejects.toThrow(message)
    })
  })

  describe('request query', () => {
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

    it('maps all supported query styles in compact input structure mode', async () => {
      const doc = await generator.generate({
        search: oc
          .meta(openapi({
            method: 'GET',
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
          .input(z.object({
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

    it('maps all supported query styles in detailed input structure mode', async () => {
      const doc = await generator.generate({
        search: oc
          .meta(openapi({
            method: 'GET',
            inputStructure: 'detailed',
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
          .input(z.object({
            query: z.object({
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

  describe('request headers', () => {
    it('maps detailed request headers', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets/{id}',
            inputStructure: 'detailed',
          }))
          .input(z.object({
            params: z.object({ id: z.string() }),
            headers: z.object({ 'x-trace-id': z.string() }),
          }))
          .output(z.object({ ok: z.boolean() })),
      })

      expect(doc.paths?.['/planets/{id}']).toEqual({
        post: expect.objectContaining({
          parameters: expect.arrayContaining([
            {
              name: 'x-trace-id',
              in: 'header',
              required: true,
              schema: expect.objectContaining({ type: 'string' }),
            },
          ]),
        }),
      })
    })
  })

  describe('request body', () => {
    it('maps compacted request bodies', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets',
          }))
          .input(z.object({ name: z.string() })),
      })

      expect(doc.paths?.['/planets']).toEqual({
        post: expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                }),
              },
            },
          },
        }),
      })
    })

    it('maps detailed request bodies', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets/{id}',
            inputStructure: 'detailed',
          }))
          .input(z.object({
            params: z.object({ id: z.string() }),
            body: z.object({ name: z.string() }),
          })),
      })

      expect(doc.paths?.['/planets/{id}']).toEqual({
        post: expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                }),
              },
            },
          },
        }),
      })
    })

    it('maps compacted optional request bodies', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets',
          }))
          .input(z.object({ name: z.string() }).optional()),
      })

      expect(doc.paths?.['/planets']).toEqual({
        post: expect.objectContaining({
          requestBody: {
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                }),
              },
            },
          },
        }),
      })
    })

    it('maps detailed optional request bodies', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets/{id}',
            inputStructure: 'detailed',
          }))
          .input(z.object({
            params: z.object({ id: z.string() }),
            body: z.object({ name: z.string() }).optional(),
          })),
      })

      expect(doc.paths?.['/planets/{id}']).toEqual({
        post: expect.objectContaining({
          requestBody: {
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                }),
              },
            },
          },
        }),
      })
    })

    describe('with files', () => {
      it('maps compacted request bodies as files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets',
            }))
            .input(z.file().mime(['application/pdf', 'application/xml'])),
        })

        expect(doc.paths?.['/planets']).toEqual({
          post: expect.objectContaining({
            requestBody: {
              required: true,
              content: {
                'application/pdf': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
                'application/xml': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
              },
            },
          }),
        })
      })

      it('maps detailed request bodies as files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets',
              inputStructure: 'detailed',
            }))
            .input(z.object({ body: z.file().mime(['application/pdf', 'application/xml']) })),
        })

        expect(doc.paths?.['/planets']).toEqual({
          post: expect.objectContaining({
            requestBody: {
              required: true,
              content: {
                'application/pdf': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
                'application/xml': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
              },
            },
          }),
        })
      })

      it('maps compacted request bodies as files without mine', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets',
            }))
            .input(z.file()),
        })

        expect(doc.paths?.['/planets']).toEqual({
          post: expect.objectContaining({
            requestBody: {
              required: true,
              content: {
                '*/*': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
              },
            },
          }),
        })
      })

      it('maps detailed request bodies as files without mine', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets',
              inputStructure: 'detailed',
            }))
            .input(z.object({ body: z.file() })),
        })

        expect(doc.paths?.['/planets']).toEqual({
          post: expect.objectContaining({
            requestBody: {
              required: true,
              content: {
                '*/*': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
              },
            },
          }),
        })
      })

      it('maps compacted request bodies with nested files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets',
            }))
            .input(z.object({ file: z.file().mime(['application/pdf', 'application/xml']) })),
        })

        expect(doc.paths?.['/planets']).toEqual({
          post: expect.objectContaining({
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: expect.objectContaining({
                    type: 'object',
                  }),
                },
              },
            },
          }),
        })
      })

      it('maps detailed request bodies with nested files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets',
              inputStructure: 'detailed',
            }))
            .input(z.object({ body: z.object({ file: z.file().mime(['application/pdf', 'application/xml']) }) })),
        })

        expect(doc.paths?.['/planets']).toEqual({
          post: expect.objectContaining({
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: expect.objectContaining({
                    type: 'object',
                  }),
                },
              },
            },
          }),
        })
      })
    })

    it('maps AsyncIteratorObject inputs to an SSE request body', async () => {
      const doc = await generator.generate({
        subscribe: oc
          .meta(openapi({}))
          .input(asyncIteratorObject(z.string(), z.boolean())),
      })

      expect(doc.paths?.['/subscribe']).toEqual({
        post: expect.objectContaining({
          requestBody: {
            content: {
              'text/event-stream': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'message' },
                        data: { type: 'string' },
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event', 'data'],
                    },
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'close' },
                        data: { type: 'boolean' },
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event', 'data'],
                    },
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'error' },
                        data: {},
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event'],
                    },
                  ],
                },
              },
            },
            required: true,
          },
        }),
      })
    })

    it('throws when detailed input has a non-object schema', async () => {
      await expect(
        generator.generate({
          test: oc.meta(openapi({ inputStructure: 'detailed' })).input(z.string()),
        }),
      ).rejects.toThrow('Procedure at path "test" has inputStructure "detailed" but its input schema is not an object.')
    })
  })

  describe('response headers', () => {
    it('maps detailed response headers', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ outputStructure: 'detailed' }))
          .output(z.object({
            headers: z.object({ 'x-request-id': z.string() }),
          })),
      })

      expect(doc.paths?.['/createPlanet']).toEqual({
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              headers: {
                'x-request-id': {
                  required: true,
                  schema: expect.objectContaining({ type: 'string' }),
                },
              },
            },
          },
        }),
      })
    })
  })

  describe('response body', () => {
    it('maps compact outputs to a success response body', async () => {
      const doc = await generator.generate({
        ping: oc
          .meta(openapi({ responseBodyHint: 'json' }))
          .output(z.object({ message: z.string() })),
      })

      expect(doc.paths?.['/ping']).toEqual({
        post: expect.objectContaining({
          operationId: 'ping',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      message: expect.objectContaining({ type: 'string' }),
                    },
                    required: ['message'],
                  }),
                },
              },
            },
          },
        }),
      })
    })

    it('maps detailed outputs to a success response body', async () => {
      const doc = await generator.generate({
        ping: oc
          .meta(openapi({ outputStructure: 'detailed' }))
          .output(z.object({ body: z.object({ message: z.string() }) })),
      })

      expect(doc.paths?.['/ping']).toEqual({
        post: expect.objectContaining({
          operationId: 'ping',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      message: expect.objectContaining({ type: 'string' }),
                    },
                    required: ['message'],
                  }),
                },
              },
            },
          },
        }),
      })
    })

    describe('with files', () => {
      it('maps compact response bodies as files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({}))
            .output(z.file().mime(['application/pdf', 'application/xml'])),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/pdf': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                  'application/xml': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('maps detailed response bodies as files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({ outputStructure: 'detailed' }))
            .output(z.object({ body: z.file().mime(['application/pdf', 'application/xml']) })),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/pdf': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                  'application/xml': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('maps compact response bodies as files without mime', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({}))
            .output(z.file()),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            responses: {
              200: {
                description: 'OK',
                content: {
                  '*/*': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('maps detailed response bodies as files without mime', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({ outputStructure: 'detailed' }))
            .output(z.object({ body: z.file() })),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            responses: {
              200: {
                description: 'OK',
                content: {
                  '*/*': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('maps compact response bodies with nested files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({}))
            .output(z.object({ file: z.file().mime(['application/pdf', 'application/xml']) })),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            responses: {
              200: {
                description: 'OK',
                content: {
                  'multipart/form-data': {
                    schema: expect.objectContaining({
                      type: 'object',
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('maps detailed response bodies with nested files', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({ outputStructure: 'detailed' }))
            .output(z.object({ body: z.object({ file: z.file().mime(['application/pdf', 'application/xml']) }) })),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            responses: {
              200: {
                description: 'OK',
                content: {
                  'multipart/form-data': {
                    schema: expect.objectContaining({
                      type: 'object',
                    }),
                  },
                },
              },
            },
          }),
        })
      })
    })

    it('maps AsyncIteratorObject outputs to an SSE success response', async () => {
      const doc = await generator.generate({
        subscribe: oc
          .meta(openapi({}))
          .output(asyncIteratorObject(z.string(), z.boolean())),
      })

      expect(doc.paths?.['/subscribe']).toEqual({
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              content: {
                'text/event-stream': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'message' },
                          data: { type: 'string' },
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event', 'data'],
                      },
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'close' },
                          data: { type: 'boolean' },
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event', 'data'],
                      },
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'error' },
                          data: {},
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event'],
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      })
    })

    it('throws when detailed output has a non-object schema', async () => {
      await expect(
        generator.generate({
          test: oc.meta(openapi({ outputStructure: 'detailed' })).output(z.string()),
        }),
      ).rejects.toThrow('Procedure at path "test" has outputStructure "detailed" but its output schema is not an object.')
    })
  })

  describe('multiple status response', () => {
    it('maps detailed outputs to per-status responses with headers', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ outputStructure: 'detailed' }))
          .output(z.union([
            z.object({
              status: z.literal(201),
              headers: z.object({ 'x-request-id': z.string() }),
              body: z.object({ id: z.string() }),
            }),
            z.object({
              status: z.literal(202).describe('202 success1'),
              body: z.object({ accepted: z.boolean() }),
            }),
            z.object({
              status: z.literal(202).describe('202 success2'),
              body: z.object({ accepted: z.string() }),
            }),
          ])),
      })

      expect(doc.paths?.['/createPlanet']).toEqual({
        post: expect.objectContaining({
          operationId: 'createPlanet',
          responses: {
            201: {
              description: 'OK',
              headers: {
                'x-request-id': {
                  required: true,
                  schema: expect.objectContaining({ type: 'string' }),
                },
              },
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      id: expect.objectContaining({ type: 'string' }),
                    },
                    required: ['id'],
                  }),
                },
              },
            },
            202: {
              description: '202 success1, 202 success2',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    anyOf: [
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          accepted: expect.objectContaining({ type: 'boolean' }),
                        },
                        required: ['accepted'],
                      }),
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          accepted: expect.objectContaining({ type: 'string' }),
                        },
                        required: ['accepted'],
                      }),
                    ],
                  }),
                },
              },
            },
          },
        }),
      })
    })

    it.each([
      {
        name: 'detailed output with a non-literal status',
        procedure: oc.meta(openapi({ outputStructure: 'detailed' })).output(z.union([
          z.object({ status: z.number(), body: z.string() }),
          z.object({ status: z.literal(201), body: z.string() }),
        ])),
        message: 'Procedure at path "test" has an invalid "status" field in its outputStructure "detailed" schema.',
      },
      {
        name: 'detailed output with a non-success status code',
        procedure: oc.meta(openapi({ outputStructure: 'detailed' })).output(z.union([
          z.object({ status: z.literal(400), body: z.string() }),
          z.object({ status: z.literal(201), body: z.string() }),
        ])),
        message: 'Procedure at path "test" has an invalid "status" field in its outputStructure "detailed" schema.',
      },
    ])('throws when $name', async ({ procedure, message }) => {
      await expect(generator.generate({ test: procedure })).rejects.toThrow(message)
    })
  })

  describe('error response', () => {
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
            404: expect.objectContaining({
              description: '404',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    oneOf: expect.arrayContaining([
                      { $ref: '#/components/schemas/UndefinedError' },
                    ]),
                  }),
                },
              },
            }),
          },
        }),
      })

      expect(doc.components?.schemas).toEqual({
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

  describe('complex schema', () => {
    describe('repeated schemas', () => {
      it('merges repeated compact GET input objects before extracting path and query parameters', async () => {
        const doc = await generator.generate({
          listPlanets: oc
            .meta(openapi({
              method: 'GET',
              path: '/systems/{systemId}/planets',
            }))
            .input(z.looseObject({ systemId: z.string() }))
            .input(z.looseObject({
              search: z.string(),
              page: z.number().optional(),
              tags: z.array(z.string()).optional(),
            }))
            .output(z.object({ ok: z.boolean() })),
        })

        expect(doc.paths?.['/systems/{systemId}/planets']).toEqual({
          get: expect.objectContaining({
            operationId: 'listPlanets',
            parameters: expect.arrayContaining([
              {
                name: 'systemId',
                in: 'path',
                required: true,
                schema: expect.objectContaining({ type: 'string' }),
              },
              {
                name: 'search',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: expect.objectContaining({ type: 'string' }),
              },
              {
                name: 'page',
                in: 'query',
                allowEmptyValue: true,
                allowReserved: true,
                schema: expect.objectContaining({ type: 'number' }),
              },
              {
                name: 'tags',
                in: 'query',
                style: 'deepObject',
                explode: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: expect.objectContaining({ type: 'array' }),
              },
            ]),
          }),
        })
      })

      it('merges repeated AsyncIteratorObject schemas', async () => {
        const doc = await generator.generate({
          procedure: oc
            .input(asyncIteratorObject(z.looseObject({ yield1: z.string() }), z.looseObject({ return1: z.string() })))
            .input(asyncIteratorObject(z.looseObject({ yield2: z.string() }), z.looseObject({ return2: z.string() })))
            .output(asyncIteratorObject(z.looseObject({ yield3: z.string() }), z.looseObject({ return3: z.string() })))
            .output(asyncIteratorObject(z.looseObject({ yield4: z.string() }), z.looseObject({ return4: z.string() }))),
        })

        expect(doc.paths?.['/procedure']?.post).toMatchObject({
          requestBody: {
            content: {
              'text/event-stream': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'message' },
                        data: { allOf: [
                          expect.objectContaining({ type: 'object', properties: { yield1: { type: 'string' } } }),
                          expect.objectContaining({ type: 'object', properties: { yield2: { type: 'string' } } }),
                        ] },
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event', 'data'],
                    },
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'close' },
                        data: { allOf: [
                          expect.objectContaining({ type: 'object', properties: { return1: { type: 'string' } } }),
                          expect.objectContaining({ type: 'object', properties: { return2: { type: 'string' } } }),
                        ] },
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event', 'data'],
                    },
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'error' },
                        data: {},
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event'],
                    },
                  ],
                },
              },
            },
            required: true,
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'text/event-stream': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'message' },
                          data: { allOf: [
                            expect.objectContaining({ type: 'object', properties: { yield3: { type: 'string' } } }),
                            expect.objectContaining({ type: 'object', properties: { yield4: { type: 'string' } } }),
                          ] },
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event', 'data'],
                      },
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'close' },
                          data: { allOf: [
                            expect.objectContaining({ type: 'object', properties: { return3: { type: 'string' } } }),
                            expect.objectContaining({ type: 'object', properties: { return4: { type: 'string' } } }),
                          ] },
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event', 'data'],
                      },
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'error' },
                          data: {},
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event'],
                      },
                    ],
                  },
                },
              },
            },
          },
        })
      })

      it('merges repeated detailed sections before mapping params, headers, bodies, and success responses', async () => {
        const doc = await generator.generate({
          updatePlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets/{id}',
              inputStructure: 'detailed',
              outputStructure: 'detailed',
            }))
            .input(z.looseObject({
              params: z.object({ id: z.string() }),
              query: z.object({ expand: z.boolean() }),
            }))
            .input(z.looseObject({
              headers: z.object({ 'x-trace-id': z.string() }),
              body: z.object({ name: z.string() }),
            }))
            .output(z.looseObject({
              headers: z.object({ 'x-request-id': z.string() }),
            }))
            .output(z.looseObject({
              body: z.object({ updated: z.boolean() }),
            })),
        })

        expect(doc.paths?.['/planets/{id}']).toEqual({
          post: expect.objectContaining({
            operationId: 'updatePlanet',
            parameters: expect.arrayContaining([
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: expect.objectContaining({ type: 'string' }),
              },
              {
                name: 'expand',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: expect.objectContaining({ type: 'boolean' }),
              },
              {
                name: 'x-trace-id',
                in: 'header',
                required: true,
                schema: expect.objectContaining({ type: 'string' }),
              },
            ]),
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                    },
                    required: ['name'],
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'OK',
                headers: {
                  'x-request-id': {
                    required: true,
                    schema: { type: 'string' },
                  },
                },
                content: {
                  'application/json': {
                    schema: expect.objectContaining({
                      type: 'object',
                      properties: {
                        updated: { type: 'boolean' },
                      },
                      required: ['updated'],
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('merges repeated detailed output objects when assembling a status-specific response', async () => {
        const doc = await generator.generate({
          createPlanet: oc
            .meta(openapi({
              method: 'POST',
              outputStructure: 'detailed',
            }))
            .output(z.looseObject({
              status: z.literal(201),
            }))
            .output(z.looseObject({
              headers: z.object({ 'x-request-id': z.string() }),
              body: z.object({ id: z.string(), slug: z.string() }),
            })),
        })

        expect(doc.paths?.['/createPlanet']).toEqual({
          post: expect.objectContaining({
            operationId: 'createPlanet',
            responses: {
              201: {
                description: 'OK',
                headers: {
                  'x-request-id': {
                    required: true,
                    schema: { type: 'string' },
                  },
                },
                content: {
                  'application/json': {
                    schema: expect.objectContaining({
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        slug: { type: 'string' },
                      },
                      required: ['id', 'slug'],
                    }),
                  },
                },
              },
            },
          }),
        })
      })
    })

    describe('union schemas', () => {
      it('extracts compact POST path params from a union and keeps the remaining request body object-shaped', async () => {
        const doc = await generator.generate({
          createEvent: oc
            .meta(openapi({
              method: 'POST',
              path: '/events/{type}',
            }))
            .input(z.discriminatedUnion('type', [
              z.object({
                type: z.literal('a'),
                a: z.string(),
              }),
              z.object({
                type: z.literal('b'),
                b: z.number(),
              }),
            ])),
        })

        expect(doc.paths?.['/events/{type}']).toEqual({
          post: expect.objectContaining({
            operationId: 'createEvent',
            parameters: [
              {
                name: 'type',
                in: 'path',
                required: true,
                schema: {
                  anyOf: [
                    { const: 'a', type: 'string' },
                    { const: 'b', type: 'string' },
                  ],
                },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      a: { type: 'string' },
                      b: { type: 'number' },
                    },
                  },
                },
              },
            },
          }),
        })
      })

      it('extracts compact GET query parameters from a union but preserves the response body union', async () => {
        const doc = await generator.generate({
          searchPlanets: oc
            .meta(openapi({
              method: 'GET',
            }))
            .input(z.discriminatedUnion('type', [
              z.object({
                type: z.literal('a'),
                a: z.string(),
              }),
              z.object({
                type: z.literal('b'),
                b: z.number(),
              }),
            ]))
            .output(z.discriminatedUnion('type', [
              z.object({
                type: z.literal('a'),
                a: z.string(),
              }),
              z.object({
                type: z.literal('b'),
                b: z.number(),
              }),
            ])),
        })

        expect(doc.paths?.['/searchPlanets']).toEqual({
          get: expect.objectContaining({
            operationId: 'searchPlanets',
            parameters: [
              {
                name: 'type',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: {
                  anyOf: [
                    { const: 'a', type: 'string' },
                    { const: 'b', type: 'string' },
                  ],
                },
              },
              {
                name: 'a',
                in: 'query',
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'b',
                in: 'query',
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'number' },
              },
            ],
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            type: { const: 'a', type: 'string' },
                            a: { type: 'string' },
                          },
                          required: ['type', 'a'],
                        }),
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            type: { const: 'b', type: 'string' },
                            b: { type: 'number' },
                          },
                          required: ['type', 'b'],
                        }),
                      ],
                    },
                  },
                },
              },
            },
          }),
        })
      })

      it('extracts compact body as files from a union', async () => {
        const doc = await generator.generate({
          searchPlanets: oc
            .input(z.union([
              z.file().mime('application/zip'),
              z.file().mime('application/pdf'),
              z.file(),
            ]))
            .output(z.union([
              z.file().mime('image/gif'),
              z.file().mime('image/png'),
              z.file(),
            ])),
        })

        expect(doc.paths?.['/searchPlanets']).toEqual({
          post: expect.objectContaining({
            operationId: 'searchPlanets',
            requestBody: expect.objectContaining({
              required: true,
              content: {
                'application/zip': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
                'application/pdf': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
                '*/*': {
                  schema: expect.objectContaining({
                    contentEncoding: 'binary',
                  }),
                },
              },
            }),
            responses: {
              200: {
                description: 'OK',
                content: {
                  'image/gif': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                  'image/png': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                  '*/*': {
                    schema: expect.objectContaining({
                      contentEncoding: 'binary',
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('extracts top-level detailed .input and .output unions', async () => {
        const doc = await generator.generate({
          syncPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets/{id}',
              inputStructure: 'detailed',
              outputStructure: 'detailed',
            }))
            .input(z.union([
              z.object({
                params: z.object({ id: z.string() }),
                query: z.object({ search: z.string() }),
                body: z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
              }),
              z.object({
                params: z.object({ id: z.number() }),
                headers: z.object({ 'x-mode': z.literal('sync') }),
                body: z.object({
                  type: z.literal('b'),
                  b: z.number(),
                }),
              }),
            ]))
            .output(z.union([
              z.object({
                status: z.literal(201),
                headers: z.object({ 'x-mode': z.literal('sync') }),
                body: z.object({
                  created: z.string(),
                }),
              }),
              z.object({
                status: z.literal(202),
                body: z.object({
                  queued: z.boolean(),
                }),
              }),
            ])),
        })

        expect(doc.paths?.['/planets/{id}']).toEqual({
          post: expect.objectContaining({
            operationId: 'syncPlanet',
            parameters: expect.arrayContaining([
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                  ],
                },
              },
              {
                name: 'search',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'x-mode',
                in: 'header',
                required: true,
                schema: { const: 'sync', type: 'string' },
              },
            ]),
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    anyOf: expect.any(Array),
                  }),
                },
              },
            },
            responses: {
              201: {
                description: 'OK',
                headers: {
                  'x-mode': {
                    required: true,
                    schema: { const: 'sync', type: 'string' },
                  },
                },
                content: {
                  'application/json': {
                    schema: expect.objectContaining({
                      type: 'object',
                      properties: {
                        created: { type: 'string' },
                      },
                      required: ['created'],
                    }),
                  },
                },
              },
              202: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: expect.objectContaining({
                      type: 'object',
                      properties: {
                        queued: { type: 'boolean' },
                      },
                      required: ['queued'],
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('extracts unions from .input.params, .input.query, .input.headers, and .output.headers in detailed mode', async () => {
        const doc = await generator.generate({
          syncPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets/{id}',
              inputStructure: 'detailed',
              outputStructure: 'detailed',
            }))
            .input(z.object({
              params: z.union([
                z.object({ id: z.string() }),
                z.object({ id: z.number() }),
              ]),
              query: z.discriminatedUnion('type', [
                z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
                z.object({
                  type: z.literal('b'),
                  b: z.number(),
                }),
              ]),
              headers: z.discriminatedUnion('type', [
                z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
                z.object({
                  type: z.literal('b'),
                  b: z.number(),
                }),
              ]),
              body: z.discriminatedUnion('type', [
                z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
                z.object({
                  type: z.literal('b'),
                  b: z.number(),
                }),
              ]),
            }))
            .output(z.object({
              headers: z.discriminatedUnion('type', [
                z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
                z.object({
                  type: z.literal('b'),
                  b: z.number(),
                }),
              ]),
              body: z.discriminatedUnion('type', [
                z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
                z.object({
                  type: z.literal('b'),
                  b: z.number(),
                }),
              ]),
            })),
        })

        expect(doc.paths?.['/planets/{id}']).toEqual({
          post: expect.objectContaining({
            operationId: 'syncPlanet',
            parameters: expect.arrayContaining([
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                  ],
                },
              },
              {
                name: 'type',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: {
                  anyOf: [
                    { const: 'a', type: 'string' },
                    { const: 'b', type: 'string' },
                  ],
                },
              },
              {
                name: 'a',
                in: 'query',
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'b',
                in: 'query',
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'number' },
              },
              {
                name: 'type',
                in: 'header',
                required: true,
                schema: {
                  anyOf: [
                    { const: 'a', type: 'string' },
                    { const: 'b', type: 'string' },
                  ],
                },
              },
              {
                name: 'a',
                in: 'header',
                schema: { type: 'string' },
              },
              {
                name: 'b',
                in: 'header',
                schema: { type: 'number' },
              },
            ]),
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          type: { const: 'a', type: 'string' },
                          a: { type: 'string' },
                        },
                        required: ['type', 'a'],
                      },
                      {
                        type: 'object',
                        properties: {
                          type: { const: 'b', type: 'string' },
                          b: { type: 'number' },
                        },
                        required: ['type', 'b'],
                      },
                    ],
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'OK',
                headers: {
                  type: {
                    required: true,
                    schema: {
                      anyOf: [
                        { const: 'a', type: 'string' },
                        { const: 'b', type: 'string' },
                      ],
                    },
                  },
                  a: {
                    schema: { type: 'string' },
                  },
                  b: {
                    schema: { type: 'number' },
                  },
                },
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            type: { const: 'a', type: 'string' },
                            a: { type: 'string' },
                          },
                          required: ['type', 'a'],
                        }),
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            type: { const: 'b', type: 'string' },
                            b: { type: 'number' },
                          },
                          required: ['type', 'b'],
                        }),
                      ],
                    },
                  },
                },
              },
            },
          }),
        })
      })
    })

    describe('intersection schemas', () => {
      it('extracts compact GET query parameters from an intersection but preserves the response body intersection', async () => {
        const doc = await generator.generate({
          listPlanets: oc
            .meta(openapi({
              method: 'GET',
            }))
            .input(z.intersection(
              z.looseObject({ search: z.string() }),
              z.looseObject({ page: z.number() }),
            ))
            .output(z.intersection(
              z.looseObject({ search: z.string() }),
              z.looseObject({ page: z.number() }),
            )),
        })

        expect(doc.paths?.['/listPlanets']).toEqual({
          get: expect.objectContaining({
            operationId: 'listPlanets',
            parameters: [
              {
                name: 'search',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'page',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'number' },
              },
            ],
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            search: { type: 'string' },
                          },
                          required: ['search'],
                        }),
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            page: { type: 'number' },
                          },
                          required: ['page'],
                        }),
                      ],
                    },
                  },
                },
              },
            },
          }),
        })
      })

      it('extracts top-level detailed .input and .output intersections', async () => {
        const doc = await generator.generate({
          syncPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets/{id}',
              inputStructure: 'detailed',
              outputStructure: 'detailed',
            }))
            .input(z.intersection(
              z.object({
                params: z.object({ id: z.string() }),
                query: z.object({ search: z.string() }),
                body: z.object({
                  type: z.literal('a'),
                  a: z.string(),
                }),
              }),
              z.object({
                headers: z.object({ 'x-mode': z.literal('sync') }),
                body: z.object({
                  archived: z.boolean(),
                }),
              }),
            ))
            .output(z.intersection(
              z.object({
                status: z.literal(201),
                headers: z.object({ 'x-mode': z.literal('sync') }),
              }),
              z.object({
                body: z.object({
                  created: z.string(),
                }),
              }),
            )),
        })

        expect(doc.paths?.['/planets/{id}']).toEqual({
          post: expect.objectContaining({
            operationId: 'syncPlanet',
            parameters: expect.arrayContaining([
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'search',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'x-mode',
                in: 'header',
                required: true,
                schema: { const: 'sync', type: 'string' },
              },
            ]),
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          type: { const: 'a', type: 'string' },
                          a: { type: 'string' },
                        },
                        required: ['type', 'a'],
                      }),
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          archived: { type: 'boolean' },
                        },
                        required: ['archived'],
                      }),
                    ],
                  },
                },
              },
            },
            responses: {
              201: {
                description: 'OK',
                headers: {
                  'x-mode': {
                    required: true,
                    schema: { const: 'sync', type: 'string' },
                  },
                },
                content: {
                  'application/json': {
                    schema: expect.objectContaining({
                      type: 'object',
                      properties: {
                        created: { type: 'string' },
                      },
                      required: ['created'],
                    }),
                  },
                },
              },
            },
          }),
        })
      })

      it('extracts intersections from .input.params, .input.query, .input.headers, and .output.headers in detailed mode', async () => {
        const doc = await generator.generate({
          syncPlanet: oc
            .meta(openapi({
              method: 'POST',
              path: '/planets/{id}/{slug}',
              inputStructure: 'detailed',
              outputStructure: 'detailed',
            }))
            .input(z.object({
              params: z.intersection(
                z.looseObject({ id: z.string() }),
                z.looseObject({ slug: z.string() }),
              ),
              query: z.intersection(
                z.looseObject({ search: z.string() }),
                z.looseObject({ page: z.number() }),
              ),
              headers: z.intersection(
                z.looseObject({ 'x-trace-id': z.string() }),
                z.looseObject({ 'x-tenant-id': z.string() }),
              ),
              body: z.intersection(
                z.looseObject({ name: z.string() }),
                z.looseObject({ archived: z.boolean() }),
              ),
            }))
            .output(z.object({
              headers: z.intersection(
                z.looseObject({ 'x-request-id': z.string() }),
                z.looseObject({ 'x-region': z.string() }),
              ),
              body: z.intersection(
                z.looseObject({ ok: z.boolean() }),
                z.looseObject({ version: z.number() }),
              ),
            })),
        })

        expect(doc.paths?.['/planets/{id}/{slug}']).toEqual({
          post: expect.objectContaining({
            operationId: 'syncPlanet',
            parameters: expect.arrayContaining([
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'slug',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'search',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'page',
                in: 'query',
                required: true,
                allowEmptyValue: true,
                allowReserved: true,
                schema: { type: 'number' },
              },
              {
                name: 'x-trace-id',
                in: 'header',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'x-tenant-id',
                in: 'header',
                required: true,
                schema: { type: 'string' },
              },
            ]),
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                        },
                        required: ['name'],
                      }),
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          archived: { type: 'boolean' },
                        },
                        required: ['archived'],
                      }),
                    ],
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'OK',
                headers: {
                  'x-request-id': {
                    required: true,
                    schema: { type: 'string' },
                  },
                  'x-region': {
                    required: true,
                    schema: { type: 'string' },
                  },
                },
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            ok: { type: 'boolean' },
                          },
                          required: ['ok'],
                        }),
                        expect.objectContaining({
                          type: 'object',
                          properties: {
                            version: { type: 'number' },
                          },
                          required: ['version'],
                        }),
                      ],
                    },
                  },
                },
              },
            },
          }),
        })
      })
    })
  })

  describe('component schemas', () => {
    describe('hoisting', () => {
      it('hoists $defs components, rewrites wrapper refs, and collapses local aliases', async () => {
        const Category: z.ZodTypeAny = z.lazy(() => z.looseObject({
          name: z.string(),
          children: z.array(Category).optional(),
        })).meta({ id: 'Category' })

        const doc = await generator.generate({
          category: oc
            .input(z.object({ category: Category }))
            .output(z.object({ category2: Category })),
        })

        expect(doc.paths?.['/category']?.post).toEqual(expect.objectContaining({
          operationId: 'category',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    category: { $ref: '#/components/schemas/Category' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      category2: { $ref: '#/components/schemas/Category' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Category: {
            type: 'object',
            additionalProperties: {},
            properties: {
              children: {
                items: {
                  $ref: '#/components/schemas/Category',
                },
                type: 'array',
              },
              name: {
                type: 'string',
              },
            },
            required: [
              'name',
            ],
          },
        })
      })

      it('hoists a component referenced by a JSON Pointer encoded', async () => {
        const planetSchema = z.object({})

        const generator = new OpenAPIGenerator({
          converters: [
            {
              condition: schema => schema === planetSchema,
              async convert(_schema, _direction) {
                return [{
                  type: 'object',
                  properties: {
                    planet: { $ref: '#/$defs/domain~1Planet' },
                  },
                  required: ['planet'],
                  $defs: {
                    'domain/Planet': {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                      },
                      required: ['id'],
                    },
                  },
                }, false]
              },
            },
          ],
        })

        const doc = await generator.generate({
          planet: oc.input(planetSchema),
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    planet: { $ref: '#/components/schemas/domain~1Planet' },
                  },
                }),
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          'domain/Planet': {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
        })
      })

      it('uses shouldHoistDef to select defs and related', async () => {
        const planetSchema = z.object({})

        const shouldHoistDef = vi.fn((defName: string, _schema) => {
          return defName !== '_PlanetAlias'
        })

        const generator = new OpenAPIGenerator({
          converters: [
            {
              condition: schema => schema === planetSchema,
              async convert(_schema, _direction) {
                return [{
                  type: 'object',
                  properties: {
                    planet: { $ref: '#/$defs/_PlanetAlias' },
                  },
                  required: ['planet'],
                  $defs: {
                    Planet: {
                      type: 'object',
                      properties: {
                        id: { $ref: '#/$defs/_PlanetId' },
                      },
                      required: ['id'],
                    },
                    _PlanetId: { type: 'string' },
                    _PlanetAlias: {
                      $ref: '#/$defs/Planet',
                    },
                  },
                }, false]
              },
            },
          ],
        })

        const doc = await generator.generate({
          planet: oc
            .input(planetSchema)
            .output(planetSchema),
        }, {
          shouldHoistDef,
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    planet: { $ref: '#/$defs/_PlanetAlias' },
                  },
                  required: ['planet'],
                  $defs: {
                    _PlanetAlias: {
                      $ref: '#/components/schemas/Planet',
                    },
                  },
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
                    properties: {
                      planet: { $ref: '#/$defs/_PlanetAlias' },
                    },
                    required: ['planet'],
                    $defs: {
                      _PlanetAlias: {
                        $ref: '#/components/schemas/Planet',
                      },
                    },
                  },
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Planet: {
            type: 'object',
            properties: {
              id: { $ref: '#/components/schemas/_PlanetId' },
            },
            required: ['id'],
          },
          _PlanetId: { type: 'string' },
        })

        expect(shouldHoistDef).toHaveBeenCalledWith('Planet', {
          type: 'object',
          properties: {
            id: { $ref: '#/$defs/_PlanetId' },
          },
          required: ['id'],
        })
        expect(shouldHoistDef).toHaveBeenCalledWith('_PlanetId', {
          type: 'string',
        })
        expect(shouldHoistDef).toHaveBeenCalledWith('_PlanetAlias', {
          $ref: '#/$defs/Planet',
        })
        expect(shouldHoistDef).toHaveBeenCalledWith('Planet', {
          type: 'object',
          properties: {
            id: { $ref: '#/$defs/_PlanetId' },
          },
          required: ['id'],
        })
        expect(shouldHoistDef).toHaveBeenCalledWith('_PlanetId', {
          type: 'string',
        })
        expect(shouldHoistDef).toHaveBeenCalledWith('_PlanetAlias', {
          $ref: '#/$defs/Planet',
        })
      })

      it('hoists $defs from each allOf branch when multiple zod inputs and outputs are combined', async () => {
        const inputSharedLeft = z.object({ source: z.literal('input-left') }).meta({ id: 'InputLeft' })
        const inputSharedRight = z.object({ source: z.literal('input-right') }).meta({ id: 'Right' })
        const outputSharedLeft = z.object({ source: z.literal('output-left') }).meta({ id: 'OutputLeft' })
        const outputSharedRight = z.object({ source: z.literal('output-right') }).meta({ id: 'Right' })

        const doc = await generator.generate({
          planet: oc
            .input(z.looseObject({ left: inputSharedLeft }))
            .input(z.looseObject({ right: inputSharedRight }))
            .output(z.looseObject({ left: outputSharedLeft }))
            .output(z.looseObject({ right: outputSharedRight })),
        }, {
          shouldHoistDef: name => name !== 'InputLeft',
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $defs: {
                    InputLeft: expect.objectContaining({
                      type: 'object',
                      properties: {
                        source: { const: 'input-left', type: 'string' },
                      },
                      required: ['source'],
                    }),
                  },
                  allOf: [
                    expect.objectContaining({
                      type: 'object',
                      properties: {
                        left: { $ref: '#/$defs/InputLeft' },
                      },
                      required: ['left'],
                    }),
                    expect.objectContaining({
                      type: 'object',
                      properties: {
                        right: { $ref: '#/components/schemas/Right' },
                      },
                      required: ['right'],
                    }),
                  ],
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
                    allOf: [
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          left: { $ref: '#/components/schemas/OutputLeft' },
                        },
                        required: ['left'],
                      }),
                      expect.objectContaining({
                        type: 'object',
                        properties: {
                          right: { $ref: '#/components/schemas/Right2' },
                        },
                        required: ['right'],
                      }),
                    ],
                  },
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual(expect.objectContaining({
          Right: expect.objectContaining({
            type: 'object',
            properties: {
              source: { const: 'input-right', type: 'string' },
            },
            required: ['source'],
          }),
          OutputLeft: expect.objectContaining({
            type: 'object',
            properties: {
              source: { const: 'output-left', type: 'string' },
            },
            required: ['source'],
          }),
          Right2: expect.objectContaining({
            type: 'object',
            properties: {
              source: { const: 'output-right', type: 'string' },
            },
            required: ['source'],
          }),
        }))
      })

      it('keeps direct recursive roots inline when they are not inside $defs', async () => {
        const Planet: z.ZodTypeAny = z.lazy(() => z.object({
          id: z.string(),
          children: z.array(Planet).optional(),
        })).meta({ id: 'Planet' })

        const doc = await generator.generate({
          planet: oc.input(Planet),
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    children: {
                      type: 'array',
                      items: { $ref: '#' },
                    },
                  },
                  required: ['id'],
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toBeUndefined()
      })

      it('can maps params, query, headers, body as $ref in detailed mode', async () => {
        const Planet: z.ZodTypeAny = z.lazy(() => z.object({
          id: z.string(),
          children: z.array(Planet).optional(),
        })).meta({ id: 'Planet' })

        const doc = await generator.generate({
          planet: oc
            .meta(openapi({ path: '/{id}', inputStructure: 'detailed', outputStructure: 'detailed' }))
            .input(z.object({
              params: z.object({ id: z.string() }).meta({ id: 'InputParams' }),
              query: z.object({ filter: z.string() }).meta({ id: 'InputQuery' }),
              headers: z.object({ 'x-token-1': z.string() }).meta({ id: 'InputHeaders' }),
              body: z.object({ name1: z.string() }).meta({ id: 'InputBody' }),
            }))
            .output(z.object({
              headers: z.object({ 'x-token-2': z.string() }).meta({ id: 'OutputHeaders' }),
              body: z.object({ name2: z.string() }).meta({ id: 'OutputBody' }),
            })),
        })

        expect(doc.paths?.['/{id}']?.post).toEqual(expect.objectContaining({
          parameters: expect.arrayContaining([
            expect.objectContaining({
              name: 'id',
              in: 'path',
            }),
            expect.objectContaining({
              name: 'filter',
              in: 'query',
            }),
            expect.objectContaining({
              name: 'x-token-1',
              in: 'header',
            }),
          ]),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InputBody' },
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OutputBody' },
                },
              },
              headers: {
                'x-token-2': expect.objectContaining({}),
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual(expect.objectContaining({
          InputBody: expect.objectContaining({
            type: 'object',
            properties: {
              name1: { type: 'string' },
            },
          }),
          OutputBody: expect.objectContaining({
            type: 'object',
            properties: {
              name2: { type: 'string' },
            },
          }),
        }))
      })
    })

    describe('name reuse', () => {
      it('reuses the same component name when input and output json schemas are equal', async () => {
        const doc = await generator.generate({
          planet: oc
            .input(z.object({ left: z.looseObject({ id: z.string() }).meta({ id: 'Planet' }) }))
            .output(z.object({ right: z.looseObject({ id: z.string() }).meta({ id: 'Planet' }) })),
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    left: { $ref: '#/components/schemas/Planet' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      right: { $ref: '#/components/schemas/Planet' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Planet: expect.objectContaining({
            type: 'object',
          }),
        })
      })

      it('reuses an equal base component without adding a postfix', async () => {
        const Planet = z.object({ id: z.string() }).meta({ id: 'Planet' })

        const doc = await generator.generate({
          planet: oc.input(z.object({ planet: Planet })),
        }, {
          base: {
            components: {
              schemas: {
                Planet: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                  required: ['id'],
                } as any,
              },
            },
          },
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    planet: { $ref: '#/components/schemas/Planet' },
                  },
                }),
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Planet: expect.objectContaining({
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          }),
        })
      })

      it('can reuses schemas reference each others recursively', async () => {
        const Schema1: z._ZodType = z.object({
          // eslint-disable-next-line ts/no-use-before-define
          schema2: z.lazy(() => Schema2).optional(),
        }).meta({ id: 'Schema1' })

        const Schema2: z.ZodTypeAny = z.object({
          schema1: z.lazy(() => Schema1).optional(),
        }).meta({ id: 'Schema2' })

        const doc = await generator.generate({
          planet1: oc
            .input(z.object({ Schema1 }))
            .output(z.object({ Schema1 })),
          planet2: oc
            .input(z.object({ Schema2 }))
            .output(z.object({ Schema2 })),
        })

        expect(doc.paths?.['/planet1']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    Schema1: { $ref: '#/components/schemas/Schema1' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      Schema1: { $ref: '#/components/schemas/Schema1' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.paths?.['/planet2']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    Schema2: { $ref: '#/components/schemas/Schema2' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      Schema2: { $ref: '#/components/schemas/Schema2' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Schema1: expect.objectContaining({
            type: 'object',
            properties: {
              schema2: { $ref: '#/components/schemas/Schema2' },
            },
          }),
          Schema2: expect.objectContaining({
            type: 'object',
            properties: {
              schema1: { $ref: '#/components/schemas/Schema1' },
            },
          }),
        })
      })
    })

    describe('name conflicts', () => {
      it('adds a numbered postfix when equal refs map to different schema', async () => {
        const PlanetInput = z.object({ id: z.string() }).meta({ id: 'Planet', description: 'PlanetInput' })
        const PlanetOutput = z.object({ id: z.number() }).meta({ id: 'Planet', description: 'PlanetOutput' })

        const doc = await generator.generate({
          planet: oc
            .input(z.object({ left: PlanetInput, right: PlanetInput }))
            .output(z.object({ left: PlanetOutput, right: PlanetOutput })),
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    left: { $ref: '#/components/schemas/Planet' },
                    right: { $ref: '#/components/schemas/Planet' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      left: { $ref: '#/components/schemas/Planet2' },
                      right: { $ref: '#/components/schemas/Planet2' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Planet: expect.objectContaining({
            description: 'PlanetInput',
          }),
          Planet2: expect.objectContaining({
            description: 'PlanetOutput',
          }),
        })
      })

      it('adds a postfix when an existing base component has a different json schema', async () => {
        const Planet: z.ZodTypeAny = z.lazy(() => z.object({
          id: z.string(),
          children: z.array(Planet).optional(),
        })).meta({ id: 'Planet' })

        const doc = await generator.generate({
          planet: oc.input(z.object({ Planet })),
        }, {
          base: {
            components: {
              schemas: {
                Planet: {
                  type: 'object',
                  properties: {
                    legacy: { type: 'boolean' },
                  },
                },
              },
            },
          },
        })

        expect(doc.paths?.['/planet']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    Planet: { $ref: '#/components/schemas/Planet2' },
                  },
                }),
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Planet: expect.objectContaining({
            type: 'object',
            properties: {
              legacy: { type: 'boolean' },
            },
          }),
          Planet2: expect.objectContaining({
            properties: expect.objectContaining({
              id: { type: 'string' },
            }),
          }),
        })
      })

      it('adds numbered postfixes for recursive reference schemas when base component names conflict', async () => {
        const Schema1: z._ZodType = z.object({
          // eslint-disable-next-line ts/no-use-before-define
          schema2: z.lazy(() => Schema2).optional(),
        }).meta({ id: 'Schema1' })

        const Schema2: z.ZodTypeAny = z.object({
          schema1: z.lazy(() => Schema1).optional(),
        }).meta({ id: 'Schema2' })

        const doc = await generator.generate({
          planet1: oc
            .input(z.object({ Schema1 }))
            .output(z.object({ Schema1 })),
          planet2: oc
            .input(z.object({ Schema2 }))
            .output(z.object({ Schema2 })),
        }, {
          base: {
            components: {
              schemas: {
                Schema1: { type: 'string' },
              },
            },
          },
        })

        expect(doc.paths?.['/planet1']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    Schema1: { $ref: '#/components/schemas/Schema12' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      Schema1: { $ref: '#/components/schemas/Schema12' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.paths?.['/planet2']?.post).toEqual(expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  type: 'object',
                  properties: {
                    Schema2: { $ref: '#/components/schemas/Schema2' },
                  },
                }),
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: expect.objectContaining({
                    type: 'object',
                    properties: {
                      Schema2: { $ref: '#/components/schemas/Schema2' },
                    },
                  }),
                },
              },
            },
          },
        }))

        expect(doc.components?.schemas).toEqual({
          Schema1: expect.objectContaining({ type: 'string' }),
          Schema12: expect.objectContaining({
            type: 'object',
            properties: {
              schema2: { $ref: '#/components/schemas/Schema2' },
            },
          }),
          Schema2: expect.objectContaining({
            type: 'object',
            properties: {
              schema1: { $ref: '#/components/schemas/Schema12' },
            },
          }),
        })
      })
    })
  })
})
