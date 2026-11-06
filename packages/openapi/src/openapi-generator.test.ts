import { oc } from '@orpc/contract'
import * as arktype from 'arktype'
import * as z from 'zod'

import {
  testSchema,
  testSchemaConverter,
  zodJsonSchemaConverter,
} from '../tests/__shared__/schema.ts'
import { openapi } from './meta.ts'
import { OpenAPIGenerator, OpenAPIGeneratorError } from './openapi-generator.ts'

describe('openAPIGenerator basic & options', () => {
  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

  it('starts from the default base document', async () => {
    await expect(generator.generate({})).resolves.toEqual({
      openapi: '3.2.0',
      info: {
        title: 'API Reference',
        version: '0.0.0',
      },
    })
  })

  it('generates QUERY operations in the default OpenAPI 3.2 document', async () => {
    const doc = await generator.generate({
      search: oc
        .meta(openapi({ method: 'QUERY', path: '/search' }))
        .input(z.object({ term: z.string() }))
        .output(z.object({ result: z.string() })),
    })

    expect(doc.openapi).toBe('3.2.0')
    expect(doc.paths?.['/search']?.query).toEqual(
      expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: expect.objectContaining({
                properties: { term: { type: 'string' } },
                required: ['term'],
              }),
            },
          },
        },
        responses: {
          200: expect.objectContaining({
            content: {
              'application/json': {
                schema: expect.objectContaining({
                  properties: { result: { type: 'string' } },
                  required: ['result'],
                }),
              },
            },
          }),
        },
      }),
    )
  })

  it('rejects QUERY operations when an older OpenAPI version is requested', async () => {
    await expect(
      generator.generate(
        {
          search: oc.meta(openapi({ method: 'QUERY', path: '/search' })),
        },
        { version: '3.1.2' },
      ),
    ).rejects.toThrow('QUERY operations require OpenAPI 3.2, but version "3.1.2" was requested.')
  })

  it('merges the provided base document and serialize the result', async () => {
    const serializer = {
      serializeJson: vi.fn((document) => ({ json: document })),
      deserializeJson: vi.fn(),
    }

    const generator = new OpenAPIGenerator({ serializer, converters: [zodJsonSchemaConverter] })

    const doc = await generator.generate(
      {},
      {
        base: {
          info: {
            title: 'Planet API',
            version: '1.2.3',
          },
          servers: [{ url: 'https://api.example.com' }],
        },
      },
    )

    expect(serializer.serializeJson).toHaveBeenCalledWith({
      openapi: '3.2.0',
      info: {
        title: 'Planet API',
        version: '1.2.3',
      },
      servers: [{ url: 'https://api.example.com' }],
    })

    expect(doc).toEqual({
      openapi: '3.2.0',
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

    const doc = await generator.generate(
      {
        planet: oc.input(z.object({ planet: z.object({ id: z.string() }).meta({ id: 'Planet' }) })),
      },
      { base },
    )

    expect(doc.components?.schemas).toEqual({
      Existing: { type: 'string' },
      Planet: expect.any(Object),
    })
    expect(base).toEqual(snapshot)
  })

  it('invokes filter with the walked path and excludes filtered procedures', async () => {
    const publicProcedure = oc.meta(openapi({ method: 'GET' }))
    const privateProcedure = oc.meta(openapi({ method: 'GET' }))

    const filter = vi.fn(
      (procedure, path) => procedure !== privateProcedure && path.join('.') !== 'admin.private',
    )

    const doc = await generator.generate(
      {
        public: publicProcedure,
        admin: {
          private: privateProcedure,
        },
      },
      {
        filter,
      },
    )

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
        .input(
          testSchema({
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          }),
        )
        .output(
          testSchema({
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          }),
        ),
    })

    expect(doc.paths?.['/planets']?.post).toEqual(
      expect.objectContaining({
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
      }),
    )
  })

  it('converts inputs with the "input" direction and outputs with the "output" direction', async () => {
    const generator = new OpenAPIGenerator({ converters: [testSchemaConverter] })

    const directionalSchema = () =>
      testSchema(
        { type: 'object', properties: { raw: { type: 'string' } }, required: ['raw'] },
        {
          output: {
            type: 'object',
            properties: { parsed: { type: 'number' } },
            required: ['parsed'],
          },
        },
      )

    const doc = await generator.generate({
      transform: oc.input(directionalSchema()).output(directionalSchema()),
    })

    expect(doc.paths?.['/transform']?.post).toEqual(
      expect.objectContaining({
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
      }),
    )
  })

  it('derives the path and operationId from router segments', async () => {
    const doc = await generator.generate({
      admin: {
        listUsers: oc.input(z.object({ page: z.number().optional() })),
      },
    })

    expect(doc.paths).toEqual({
      '/admin/listUsers': {
        post: expect.objectContaining({
          operationId: 'admin.listUsers',
        }),
      },
    })
  })

  it('applies route metadata: method, prefix, path, operationId, tags, summary, description, deprecated', async () => {
    const doc = await generator.generate({
      getPlanet: oc
        .meta(
          openapi({
            method: 'GET',
            prefix: '/api/v2',
            path: '/planets/{id}',
            operationId: 'getPlanetById',
            tags: ['planets'],
            summary: 'Get a planet',
            description: 'Returns a single planet.',
            deprecated: true,
          }),
        )
        .input(z.object({ id: z.string() })),
    })

    expect(doc.paths?.['/api/v2/planets/{id}']).toEqual({
      get: expect.objectContaining({
        operationId: 'getPlanetById',
        tags: ['planets'],
        summary: 'Get a planet',
        description: 'Returns a single planet.',
        deprecated: true,
        parameters: [expect.objectContaining({ name: 'id', in: 'path', required: true })],
      }),
    })
  })

  it('merges multiple procedures on the same path into a single path item', async () => {
    const doc = await generator.generate({
      listPlanets: oc.meta(openapi({ method: 'GET', path: '/planets' })),
      createPlanet: oc
        .meta(openapi({ method: 'POST', path: '/planets' }))
        .input(z.object({ name: z.string() })),
    })

    expect(doc.paths?.['/planets']).toEqual({
      get: expect.objectContaining({ operationId: 'listPlanets' }),
      post: expect.objectContaining({ operationId: 'createPlanet' }),
    })
  })

  it('replaces the whole operation with an openapi.spec object, bypassing generation', async () => {
    const doc = await generator.generate({
      // this procedure would normally throw: GET with non-object input schema
      getPlanet: oc
        .meta(
          openapi({
            method: 'GET',
            spec: { operationId: 'custom.getPlanet' },
          }),
        )
        .input(z.string()),
    })

    expect(doc.paths?.['/getPlanet']).toEqual({
      get: { operationId: 'custom.getPlanet' },
    })
  })

  it('extends the generated operation with an openapi.spec function', async () => {
    const doc = await generator.generate({
      getPlanet: oc.meta(
        openapi({
          method: 'GET',
          spec: (current) => ({ ...current, security: [{ bearerAuth: [] }] }),
        }),
      ),
    })

    expect(doc.paths?.['/getPlanet']).toEqual({
      get: expect.objectContaining({
        operationId: 'getPlanet',
        security: [{ bearerAuth: [] }],
      }),
    })
  })

  it('merges multiple input and output schemas with allOf', async () => {
    const doc = await generator.generate({
      planet: oc
        .input(z.looseObject({ name: z.string() }))
        .input(z.looseObject({ note: z.string() }).optional())
        .output(z.looseObject({ id: z.string() }))
        .output(z.looseObject({ slug: z.string() })),
    })

    expect(doc.paths?.['/planet']?.post).toEqual(
      expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                allOf: [
                  expect.objectContaining({ required: ['name'] }),
                  expect.objectContaining({ required: ['note'] }),
                ],
              },
            },
          },
        },
        responses: {
          200: expect.objectContaining({
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    expect.objectContaining({ required: ['id'] }),
                    expect.objectContaining({ required: ['slug'] }),
                  ],
                },
              },
            },
          }),
        },
      }),
    )
  })

  it('keeps merged request bodies optional when every input schema is optional', async () => {
    const doc = await generator.generate({
      planet: oc
        .input(z.looseObject({ name: z.string() }).optional())
        .input(z.looseObject({ note: z.string() }).optional()),
    })

    expect((doc.paths?.['/planet']?.post?.requestBody as any).required).toBeUndefined()
  })

  it('resolves $ref schemas when choosing query styles and body content types', async () => {
    const Status = z.enum(['a', 'b']).meta({ id: 'Status' })

    const doc = await generator.generate({
      list: oc
        .meta(openapi({ method: 'GET', path: '/list' }))
        .input(z.object({ status: Status, statuses: z.union([Status, z.array(Status)]) })),
      download: oc
        .meta(openapi({ method: 'GET', path: '/download', outputStructure: 'detailed' }))
        .output(
          z.union([
            z.object({ status: z.literal(200), body: z.file().meta({ id: 'Download' }) }),
            z.object({ status: z.literal(201), body: z.object({ id: z.string() }) }),
          ]),
        ),
    })

    expect(doc.paths?.['/list']?.get?.parameters).toEqual([
      {
        in: 'query',
        name: 'status',
        required: true,
        allowEmptyValue: true,
        allowReserved: true,
        schema: { $ref: '#/components/schemas/Status' },
      },
      {
        in: 'query',
        name: 'statuses',
        required: true,
        allowEmptyValue: true,
        allowReserved: true,
        schema: {
          anyOf: [
            { $ref: '#/components/schemas/Status' },
            { type: 'array', items: { $ref: '#/components/schemas/Status' } },
          ],
        },
      },
    ])

    expect(doc.paths?.['/download']?.get?.responses).toEqual({
      200: {
        description: 'OK',
        content: { '*/*': { schema: { $ref: '#/components/schemas/Download' } } },
      },
      201: {
        description: 'OK',
        content: {
          'application/json': {
            schema: expect.objectContaining({ properties: { id: { type: 'string' } } }),
          },
        },
      },
    })
  })

  it('treats boolean schemas as unconstrained', async () => {
    const generator = new OpenAPIGenerator({ converters: [testSchemaConverter] })

    const doc = await generator.generate({
      ping: oc.input(testSchema(true)),
    })

    expect(doc.paths?.['/ping']?.post?.requestBody).toBeUndefined()
  })

  it('strips the $schema field from converted schemas', async () => {
    const generator = new OpenAPIGenerator({ converters: [testSchemaConverter] })

    const doc = await generator.generate({
      ping: oc.input(
        testSchema({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
        } as any),
      ),
    })

    expect(
      (doc.paths?.['/ping']?.post?.requestBody as any).content['application/json'].schema,
    ).toEqual({
      type: 'object',
    })
  })

  it('aggregates all generator errors into a single OpenAPIGeneratorError', async () => {
    const error = await generator
      .generate({
        first: oc.meta(openapi({ path: '/planets/{id}' })),
        nested: {
          second: oc.meta(openapi({ method: 'GET' })).input(z.string()),
        },
      })
      .then(
        () => {
          throw new Error('expected generate to reject')
        },
        (e) => e,
      )

    expect(error).toBeInstanceOf(OpenAPIGeneratorError)
    expect(error.message).toContain('Failed to generate the OpenAPI document (2 errors)')
    expect(error.message).toContain('Procedure at first:')
    expect(error.message).toContain('Procedure at nested.second:')

    const single = await generator
      .generate({
        only: oc.meta(openapi({ method: 'GET' })).input(z.string()),
      })
      .then(
        () => {
          throw new Error('expected generate to reject')
        },
        (e) => e,
      )

    expect(single.message).toContain('Failed to generate the OpenAPI document (1 error)')

    const root = await generator
      .generate(oc.meta(openapi({ method: 'GET' })).input(z.string()))
      .then(
        () => {
          throw new Error('expected generate to reject')
        },
        (e) => e,
      )

    expect(root.message).toContain('Procedure at (root):')

    const emptyKey = await generator
      .generate({
        '': oc.meta(openapi({ method: 'GET' })).input(z.string()),
      })
      .then(
        () => {
          throw new Error('expected generate to reject')
        },
        (e) => e,
      )

    expect(emptyKey.message).toContain('Procedure at : ')
    expect(emptyKey.message).not.toContain('(root)')
  })

  it.each([
    {
      name: 'the same method and path',
      paths: ['/users', '/users'] as const,
      message: 'GET /users is already documented by the procedure at first',
    },
    {
      name: 'a {+param} and a {param} at the same position',
      paths: ['/files/{+p}', '/files/{p}'] as const,
      message: 'GET /files/{p} is already documented by the procedure at first',
    },
    {
      name: 'path params that differ only by name',
      paths: ['/users/{id}', '/users/{name}'] as const,
      message: 'GET /users/{name} is already documented by the procedure at first',
    },
  ])('reports a collision instead of overwriting for $name', async ({ paths, message }) => {
    const input = z.object({ id: z.string(), p: z.string(), name: z.string() })
    const result = generator.generate({
      first: oc.meta(openapi({ method: 'GET', path: paths[0] })).input(input),
      second: oc.meta(openapi({ method: 'GET', path: paths[1] })).input(input),
    })

    await expect(result).rejects.toThrow('(1 error)')
    await expect(result).rejects.toThrow(`Procedure at second: ${message}`)
  })

  it('does not report collisions for filtered-out procedures', async () => {
    const doc = await generator.generate(
      {
        first: oc.meta(openapi({ method: 'GET', path: '/users' })),
        second: oc.meta(openapi({ method: 'GET', path: '/users' })),
      },
      {
        filter: (_, path) => path[0] !== 'second',
      },
    )

    expect(doc.paths?.['/users']).toEqual({
      get: expect.objectContaining({ operationId: 'first' }),
    })
  })

  it('reports duplicate operationIds', async () => {
    await expect(
      generator.generate({
        first: oc.meta(openapi({ method: 'GET', path: '/a', operationId: 'same' })),
        nested: {
          second: oc.meta(
            openapi({ method: 'GET', path: '/b', spec: (op) => ({ ...op, operationId: 'same' }) }),
          ),
        },
      }),
    ).rejects.toThrow(
      'Procedure at nested.second: operationId "same" is already used by the procedure at first',
    )
  })

  it('documents the success status for an optional detailed status', async () => {
    const doc = await generator.generate({
      create: oc
        .meta(openapi({ method: 'POST', outputStructure: 'detailed' }))
        .output(z.object({ status: z.literal(201).optional(), body: z.string() })),
    })

    expect(Object.keys(doc.paths?.['/create']?.post?.responses ?? {})).toEqual(['200', '201'])
  })

  it('rethrows non-generator errors immediately without wrapping', async () => {
    const generator = new OpenAPIGenerator({
      converters: [
        {
          condition: () => true,
          convert: () => {
            throw new Error('converter exploded')
          },
        },
      ],
    })

    const error = await generator
      .generate({
        ping: oc.input(z.string()),
      })
      .then(
        () => {
          throw new Error('expected generate to reject')
        },
        (e) => e,
      )

    expect(error).not.toBeInstanceOf(OpenAPIGeneratorError)
    expect(error.message).toBe('converter exploded')
  })
})

describe('openAPIGenerator version', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter] })

  const router = {
    planet: oc
      .meta(openapi({ method: 'GET', path: '/planets/{id}' }))
      .input(
        testSchema({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),
      )
      .output(testSchema({ type: 'object', properties: { name: { type: ['string', 'null'] } } })),
  }

  const planetPath = {
    get: {
      operationId: 'planet',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: ['string', 'null'] } } },
            },
          },
        },
      },
    },
  }

  it.each(['3.2.0', '3.2.7'] as const)('generates OpenAPI %s', async (version) => {
    await expect(generator.generate(router, { version })).resolves.toEqual({
      openapi: version,
      info: { title: 'API Reference', version: '0.0.0' },
      paths: { '/planets/{id}': planetPath },
    })
  })

  it.each(['3.1.2', '3.1.0'] as const)('downgrades to OpenAPI %s', async (version) => {
    await expect(generator.generate(router, { version })).resolves.toEqual({
      openapi: version,
      info: { title: 'API Reference', version: '0.0.0' },
      paths: { '/planets/{id}': planetPath },
    })
  })

  it.each(['3.0.4', '3.0.0'] as const)('downgrades to OpenAPI %s', async (version) => {
    await expect(generator.generate(router, { version })).resolves.toEqual({
      openapi: version,
      info: { title: 'API Reference', version: '0.0.0' },
      paths: {
        '/planets/{id}': {
          get: {
            ...planetPath.get,
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { name: { type: 'string', nullable: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
  })

  it.each(['3.2.0', '3.1.0', '3.0.3'] as const)(
    'preserves error titles in OpenAPI %s',
    async (version) => {
      const doc = await generator.generate(
        {
          create: oc.meta(openapi({ method: 'POST', path: '/penguins' })).errors({
            PENGUIN_NAME_BANNED: {},
            PENGUIN_COLONY_FULL: {},
          }),
        },
        {
          version,
          errorStatusMap: { PENGUIN_NAME_BANNED: 400, PENGUIN_COLONY_FULL: 400 },
        },
      )

      const response = doc.paths?.['/penguins']?.post?.responses?.['400']
      expect(response).toMatchObject({
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { $ref: '#/components/schemas/PenguinNameBanned' },
                { $ref: '#/components/schemas/PenguinColonyFull' },
                { $ref: '#/components/schemas/UndefinedError' },
              ],
            },
          },
        },
      })
      expect(doc.components?.schemas).toMatchObject({
        PenguinNameBanned: { title: 'PENGUIN_NAME_BANNED' },
        PenguinColonyFull: { title: 'PENGUIN_COLONY_FULL' },
        UndefinedError: { title: 'UndefinedError' },
      })
    },
  )

  describe.each(['3.2.0', '3.1.1', '3.0.4'] as const)(
    'component names in OpenAPI %s',
    (version) => {
      const zodGenerator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })
      const ids = ['root~/', 'User Profile', 'api:User', 'Page<User>']

      const contract = {
        list: oc
          .meta(openapi({ method: 'GET', path: '/things' }))
          .output(
            z.object(
              Object.fromEntries(
                ids.map((id, i) => [`field${i}`, z.object({ value: z.literal(i) }).meta({ id })]),
              ),
            ),
          ),
      }

      function collectRefs(value: unknown, refs: string[] = []): string[] {
        if (Array.isArray(value)) {
          value.forEach((item) => collectRefs(item, refs))
        } else if (value && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) {
            if (key === '$ref' && typeof item === 'string') {
              refs.push(item)
            } else {
              collectRefs(item, refs)
            }
          }
        }

        return refs
      }

      it('sanitizes schema ids into valid component keys by default', async () => {
        const doc = await zodGenerator.generate(contract, { version })
        const schemas = doc.components?.schemas ?? {}

        expect(Object.keys(schemas)).toEqual(['root__', 'User_Profile', 'api_User', 'Page_User_'])
        for (const key of Object.keys(schemas)) {
          expect(key).toMatch(/^[\w.-]+$/)
        }

        expect(doc.paths?.['/things']?.get?.responses?.['200']).toMatchObject({
          content: {
            'application/json': {
              schema: {
                properties: {
                  field0: { $ref: '#/components/schemas/root__' },
                  field1: { $ref: '#/components/schemas/User_Profile' },
                  field2: { $ref: '#/components/schemas/api_User' },
                  field3: { $ref: '#/components/schemas/Page_User_' },
                },
              },
            },
          },
        })
      })

      it('keeps componentName overrides and writes their refs as valid URI references', async () => {
        const doc = await zodGenerator.generate(contract, {
          version,
          componentName: (defName) => defName,
        })

        expect(Object.keys(doc.components?.schemas ?? {})).toEqual(ids)

        const refs = collectRefs(doc.paths)
        const expectedRefs = [
          '#/components/schemas/root~0~1',
          '#/components/schemas/User%20Profile',
          '#/components/schemas/api:User',
          '#/components/schemas/Page%3CUser%3E',
        ]
        // the 3.0 downgrade inlines percent-encoded refs, which 3.0 tooling handles poorly
        expect(refs).toEqual(
          version.startsWith('3.0.')
            ? expectedRefs.filter((ref) => !ref.includes('%'))
            : expectedRefs,
        )

        for (const ref of refs) {
          // every ref resolves to a component after URI and JSON Pointer decoding
          const name = decodeURIComponent(ref.slice('#/components/schemas/'.length))
            .replaceAll('~1', '/')
            .replaceAll('~0', '~')
          expect(doc.components?.schemas).toHaveProperty([name])
          expect(ref).not.toMatch(/[\s<>]/)
        }
      })
    },
  )

  it('serializes non-JSON values after downgrading', async () => {
    const doc = await generator.generate(
      {},
      {
        version: '3.0.4',
        base: {
          info: {
            'title': 'Planet API',
            'version': '1.0.0',
            'x-generated-at': new Date('2020-01-01T00:00:00.000Z'),
          },
        },
      },
    )

    expect(doc.info['x-generated-at']).toBe('2020-01-01T00:00:00.000Z')
  })
})
