import type { AnyContractProcedure } from '@orpc/contract'
import { eventIterator, oc } from '@orpc/contract'
import * as z from 'zod'
import { ZodToJsonSchemaConverter } from '../../zod/src/zod4'
import { customOpenAPIOperation } from './openapi-custom'
import { OpenAPIGenerator } from './openapi-generator'

type TestCase = {
  name: string
  contract: AnyContractProcedure
  expected: any
  error?: undefined
} | {
  name: string
  contract: AnyContractProcedure
  expected?: undefined
  error: string
}

const routeTests: TestCase[] = [
  {
    name: 'default',
    contract: oc,
    expected: {
      '/': {
        post: expect.any(Object),
      },
    },
  },
  {
    name: 'path + method',
    contract: oc.route({ path: '/planets', method: 'GET' }),
    expected: {
      '/planets': {
        get: expect.any(Object),
      },
    },
  },
  {
    name: 'dynamic params + method',
    contract: oc.route({ path: '/planets/{id}', method: 'DELETE' }).input(z.object({ id: z.string() })),
    expected: {
      '/planets/{id}': {
        delete: expect.any(Object),
      },
    },
  },
  {
    name: 'rest params + method',
    contract: oc.route({ path: '/planets/{+path}', method: 'DELETE' }).input(z.object({ path: z.string() })),
    expected: {
      '/planets/{path}': {
        delete: expect.any(Object),
      },
    },
  },
  {
    name: 'metadata',
    contract: oc.route({
      operationId: 'customOperationId',
      tags: ['planets'],
      summary: 'the summary',
      description: 'the description',
      successStatus: 203,
      successDescription: 'the success description',
      deprecated: true,
    }),
    expected: {
      '/': {
        post: expect.objectContaining({
          operationId: 'customOperationId',
          tags: ['planets'],
          summary: 'the summary',
          description: 'the description',
          deprecated: true,
          responses: {
            203: expect.objectContaining({
              description: 'the success description',
            }),
          },
        }),
      },
    },
  },
]

const inputTests: TestCase[] = [
  {
    name: 'invalid input',
    contract: oc.route({ path: '/planets/{id}' }),
    error: 'When input structure is "compact", and path has dynamic params, input schema must be an object with all dynamic params as required.',
  },
  {
    name: 'invalid input',
    contract: oc.route({ path: '/planets/{id}' }).input(z.string()),
    error: 'When input structure is "compact", and path has dynamic params, input schema must be an object with all dynamic params as required.',
  },
  {
    name: 'params must be required',
    contract: oc.route({ path: '/planets/{id}' }).input(z.object({ id: z.string().optional(), value: z.string().optional() })),
    error: 'When input structure is "compact", and path has dynamic params, input schema must be an object with all dynamic params as required.',
  },
  {
    name: 'dynamic params + body',
    contract: oc.route({ path: '/planets/{id}' }).input(z.object({ id: z.string(), value: z.string() })),
    expected: {
      '/planets/{id}': {
        post: expect.objectContaining({
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
              },
            },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    value: {
                      type: 'string',
                    },
                  },
                  required: ['value'],
                },
              },
            },
            required: true,
          },
        }),
      },
    },
  },
  {
    name: 'query + params',
    contract: oc.route({ path: '/planets/{id}', method: 'GET' }).input(
      z.object({
        id: z.string(),
        query1: z.string(),
        query2: z.number().optional(),
        query3: z.object({
          a: z.string(),
        }).optional(),
        query4: z.array(z.number()).or(z.number()),
      }),
    ),
    expected: {
      '/planets/{id}': {
        get: expect.objectContaining({
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'query1',
              in: 'query',
              required: true,
              schema: {
                type: 'string',
              },
              allowEmptyValue: true,
              allowReserved: true,
            },
            {
              name: 'query2',
              in: 'query',
              required: false,
              schema: {
                type: 'number',
              },
              allowEmptyValue: true,
              allowReserved: true,
            },
            {
              name: 'query3',
              in: 'query',
              required: false,
              schema: {
                type: 'object',
                properties: {
                  a: {
                    type: 'string',
                  },
                },
                required: ['a'],
              },
              style: 'deepObject',
              explode: true,
              allowEmptyValue: true,
              allowReserved: true,
            },
            {
              name: 'query4',
              in: 'query',
              required: true,
              schema: {
                anyOf: [
                  {
                    type: 'array',
                    items: {
                      type: 'number',
                    },
                  },
                  {
                    type: 'number',
                  },
                ],
              },
              allowEmptyValue: true,
              allowReserved: true,
            },
          ],
        }),
      },
    },
  },
  {
    name: 'not throw in GET + any input',
    contract: oc.route({ method: 'GET' }).input(z.any()),
    expected: {
      '/': {
        get: expect.objectContaining({
        }),
      },
    },
  },
  {
    name: 'GET + non-object input',
    contract: oc.route({ method: 'GET' }).input(z.string()),
    error: 'When method is "GET", input schema must satisfy: object | any | unknown',
  },
  {
    name: 'file',
    contract: oc.input(z.file().mime(['image/png'])),
    expected: {
      '/': {
        post: expect.objectContaining({
          requestBody: {
            content: {
              'image/png': {
                schema: {
                  type: 'string',
                  contentMediaType: 'image/png',
                },
              },
            },
            required: true,
          },
        }),
      },
    },
  },
  {
    name: 'event iterator',
    contract: oc.input(eventIterator(z.string(), z.boolean())),
    expected: {
      '/': {
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
                        event: { const: 'done' },
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
      },
    },
  },
  {
    name: 'inputStructure=detailed',
    contract: oc.route({ path: '/planets/{id}', inputStructure: 'detailed' }).input(z.object({
      params: z.object({ id: z.string() }),
      query: z.object({ query1: z.string(), query2: z.number().optional() }),
      headers: z.object({ header1: z.string(), header2: z.string().optional() }),
      body: z.string(),
    })),
    expected: {
      '/planets/{id}': {
        post: expect.objectContaining({
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'query1',
              in: 'query',
              required: true,
              schema: {
                type: 'string',
              },
              allowEmptyValue: true,
              allowReserved: true,
            },
            {
              name: 'query2',
              in: 'query',
              required: false,
              schema: {
                type: 'number',
              },
              allowEmptyValue: true,
              allowReserved: true,
            },
            {
              name: 'header1',
              in: 'header',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'header2',
              in: 'header',
              required: false,
              schema: {
                type: 'string',
              },
            },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'string' },
              },
            },
            required: true,
          },
        }),
      },
    },
  },
  {
    name: 'inputStructure=detailed all field is optional',
    contract: oc.route({ inputStructure: 'detailed' }).input(z.object({})),
    expected: {
      '/': {
        post: expect.toSatisfy(v => !v.parameters && !v.requestBody),
      },
    },
  },
  {
    name: 'inputStructure=detailed + invalid input',
    contract: oc.route({ inputStructure: 'detailed' }).input(z.string()),
    error: 'When input structure is "detailed", input schema must satisfy',
  },
  {
    name: 'inputStructure=detailed + invalid input',
    contract: oc.route({ inputStructure: 'detailed', path: '/{id}' }),
    error: 'When input structure is "detailed", input schema must satisfy',
  },
  {
    name: 'inputStructure=detailed + invalid input',
    contract: oc.route({ inputStructure: 'detailed' }).input(z.object({ })),
    expected: expect.any(Object),
  },
  {
    name: 'inputStructure=detailed + invalid input',
    contract: oc.route({ inputStructure: 'detailed' }).input(z.object({ query: z.string() })),
    error: 'When input structure is "detailed", input schema must satisfy',
  },
  {
    name: 'inputStructure=detailed + invalid input',
    contract: oc.route({ inputStructure: 'detailed', path: '/{id}' }).input(z.object({ params: z.object({ id: z.string().optional() }) })),
    error: 'When input structure is "detailed" and path has dynamic params, the "params" schema must be an object with all dynamic params as required.',
  },
]

const successResponseTests: TestCase[] = [
  {
    name: 'compact mode',
    contract: oc.output(z.string()),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
          },
        }),
      },
    },
  },
  {
    name: 'event iterator',
    contract: oc.output(eventIterator(z.string(), z.boolean())),
    expected: {
      '/': {
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
                          event: { const: 'done' },
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
      },
    },
  },
  {
    name: 'outputStructure=detailed',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.object({
      headers: z.object({ header1: z.string(), header2: z.string().optional() }),
      body: z.string(),
    })),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'string' },
                },
              },
              headers: {
                header1: {
                  required: true,
                  schema: {
                    type: 'string',
                  },
                },
                header2: {
                  required: false,
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
          },
        }),
      },
    },
  },
  {
    name: 'outputStructure=detailed all fields is optional',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.object({})),
    expected: {
      '/': {
        post: {
          operationId: '',
          responses: {
            200: expect.toSatisfy(v => !v.content && !v.headers),
          },
        },
      },
    },
  },
  {
    name: 'outputStructure=detailed',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.string()),
    error: 'When output structure is "detailed", output schema must satisfy',
  },
  {
    name: 'outputStructure=detailed',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.object({ headers: z.string() })),
    error: 'When output structure is "detailed", output schema must satisfy',
  },
  {
    name: 'outputStructure=compact + output is optional',
    contract: oc.route({ outputStructure: 'compact' }).output(z.object({ name: z.string() }).optional()),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    anyOf: [
                      {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                        },
                        required: ['name'],
                      },
                      {
                        not: {},
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      },
    },
  },
  {
    name: 'outputStructure=detailed + body is optional',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.object({ body: z.object({ name: z.string() }).optional() })),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    anyOf: [
                      {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                        },
                        required: ['name'],
                      },
                      {
                        not: {},
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      },
    },
  },
  {
    name: 'outputStructure=detailed + headers is optional',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.object({ headers: z.object({ 'x-custom': z.string() }).optional() })),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: expect.objectContaining({
              headers: {
                'x-custom': {
                  required: undefined,
                  schema: {
                    type: 'string',
                  },
                },
              },
            }),
          },
        }),
      },
    },
  },
  {
    name: 'outputStructure=detailed + multiple status',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.union([
      z.object({ body: z.string() }),
      z.object({ status: z.literal(201).describe('201 description'), body: z.object({ name: z.string() }), headers: z.object({ 'x-custom-header': z.string() }) }),
    ])),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
            201: {
              description: '201 description',
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
              headers: {
                'x-custom-header': {
                  required: true,
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
          },
        }),
      },
    },
  },
  {
    name: 'outputStructure=detailed + duplicate method',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.union([
      z.object({ status: z.literal(201), body: z.string() }),
      z.object({ status: z.literal(201).describe('201 description') }),
    ])),
    error: 'When output structure is "detailed", each success status must be unique.',
  },
  {
    name: 'outputStructure=detailed + invalid status - 1',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.union([
      z.object({ status: z.number(), body: z.string() }),
      z.object({ status: z.literal(201).describe('201 description') }),
    ])),
    error: ' When output structure is "detailed", output schema must satisfy:',
  },
  {
    name: 'outputStructure=detailed + invalid status - 2',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.union([
      z.object({ status: z.literal('200'), body: z.string() }),
      z.object({ status: z.literal(201).describe('201 description') }),
    ])),
    error: ' When output structure is "detailed", output schema must satisfy:',
  },
  {
    name: 'outputStructure=detailed + invalid status - 3',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.union([
      z.object({ status: z.literal(201.1), body: z.string() }),
      z.object({ status: z.literal(201).describe('201 description') }),
    ])),
    error: ' When output structure is "detailed", output schema must satisfy:',
  },
  {
    name: 'outputStructure=detailed + invalid status - 4',
    contract: oc.route({ outputStructure: 'detailed' }).output(z.union([
      z.object({ status: z.literal(400), body: z.string() }),
      z.object({ status: z.literal(201).describe('201 description') }),
    ])),
    error: ' When output structure is "detailed", output schema must satisfy:',
  },
]

const errorResponseTests: TestCase[] = [
  {
    name: 'without errors',
    contract: oc,
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: {
            200: expect.objectContaining({}),
          },
        }),
      },
    },
  },
  {
    name: 'with errors',
    contract: oc.errors({
      UNAUTHORIZED: {
        data: z.object({ token: z.string() }),
      },
      UNAUTHORIZED_TEST: {
        status: 401,
        message: 'Unauthorized test',
        data: z.object({ token: z.string() }).optional(),
      },
      FORBIDDEN: undefined,
      TEST: {},
    }),
    expected: {
      '/': {
        post: expect.objectContaining({
          responses: expect.objectContaining({
            401: {
              description: '401',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          defined: { const: true },
                          code: { const: 'UNAUTHORIZED' },
                          status: { const: 401 },
                          message: { type: 'string', default: 'Unauthorized' },
                          data: {
                            type: 'object',
                            properties: {
                              token: { type: 'string' },
                            },
                            required: ['token'],
                          },
                        },
                        required: ['defined', 'code', 'status', 'message', 'data'],
                      },
                      {
                        type: 'object',
                        properties: {
                          defined: { const: true },
                          code: { const: 'UNAUTHORIZED_TEST' },
                          status: { const: 401 },
                          message: { type: 'string', default: 'Unauthorized test' },
                          data: {
                            type: 'object',
                            properties: {
                              token: { type: 'string' },
                            },
                            required: ['token'],
                          },
                        },
                        required: ['defined', 'code', 'status', 'message'],
                      },
                      {
                        type: 'object',
                        properties: {
                          defined: { const: false },
                          code: { type: 'string' },
                          status: { type: 'number' },
                          message: { type: 'string' },
                          data: {},
                        },
                        required: ['defined', 'code', 'status', 'message'],
                      },
                    ],
                  },
                },
              },
            },
            500: {
              description: '500',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          defined: { const: true },
                          code: { const: 'TEST' },
                          status: { const: 500 },
                          message: { type: 'string', default: 'TEST' },
                          data: {},
                        },
                        required: ['defined', 'code', 'status', 'message'],
                      },
                      {
                        type: 'object',
                        properties: {
                          defined: { const: false },
                          code: { type: 'string' },
                          status: { type: 'number' },
                          message: { type: 'string' },
                          data: {},
                        },
                        required: ['defined', 'code', 'status', 'message'],
                      },
                    ],
                  },
                },
              },
            },
          }),
        }),
      },
    },
  },
]

const customOperationTests: TestCase[] = [
  {
    name: 'with security custom',
    contract: oc.errors({
      TEST: customOpenAPIOperation({ }, () => ({ security: [{ bearerAuth: [] }] })),
    }).input(z.object({ id: z.string() })).output(z.object({ name: z.string() })),
    expected: {
      '/': {
        post: {
          security: [{ bearerAuth: [] }],
        },
      },
    },
  },
  {
    name: 'override entire operation object',
    contract: oc
      .route({
        spec: {
          operationId: 'customOperationId',
          tags: ['tag'],
          summary: '__OVERRIDE__',
        },
      })
      .errors({
        TEST: customOpenAPIOperation({}, { security: [{ bearerAuth: [] }] }),
      })
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() })),
    expected: {
      '/': {
        post: {
          operationId: 'customOperationId',
          tags: ['tag'],
          summary: '__OVERRIDE__',
          security: [{ bearerAuth: [] }],
        },
      },
    },
  },
  {
    name: 'extend operation object',
    contract: oc
      .route({
        spec: spec => ({
          ...spec,
          operationId: 'customOperationId',
          summary: '__OVERRIDE__',
        }),
      })
      .errors({
        TEST: customOpenAPIOperation({}, { security: [{ bearerAuth: [] }] }),
      })
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() })),
    expected: {
      '/': {
        post: {
          operationId: 'customOperationId',
          summary: '__OVERRIDE__',
          security: [{ bearerAuth: [] }],
          requestBody: expect.any(Object),
          responses: expect.any(Object),
        },
      },
    },
  },
]

it.each([
  ...routeTests,
  ...inputTests,
  ...successResponseTests,
  ...errorResponseTests,
  ...customOperationTests,
])('openAPIGenerator.generate: %# - $name', async ({ contract, expected, error }) => {
  const openAPIGenerator = new OpenAPIGenerator({
    schemaConverters: [
      new ZodToJsonSchemaConverter(),
    ],
  })

  const promise = openAPIGenerator.generate(contract, {
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  if (error) {
    await expect(promise).rejects.toThrow(error)
  }
  else {
    await expect(promise).resolves.toEqual({
      openapi: '3.1.1',
      info: {
        title: 'test',
        version: '1.0.0',
      },
      paths: expected,
    })
  }
})

describe('openAPIGenerator', () => {
  it('can generate without base docs', async () => {
    const openAPIGenerator = new OpenAPIGenerator()
    const spec = await openAPIGenerator.generate({})

    expect(spec).toEqual({
      openapi: '3.1.1',
      info: {
        title: 'API Reference',
        version: '0.0.0',
      },
    })
  })

  it('openAPIGenerator.generate throw right away if unknown error', async () => {
    const openAPIGenerator = new OpenAPIGenerator({
      schemaConverters: [
        {
          condition: () => true,
          convert: () => {
            throw new Error('unknown error')
          },
        },
      ],
    })

    await expect(openAPIGenerator.generate(oc, {
      info: {
        title: 'test',
        version: '1.0.0',
      },
    })).rejects.toThrow('unknown error')
  })

  it('respect exclude option', async () => {
    const openAPIGenerator = new OpenAPIGenerator({
    })

    const exclude = vi.fn(procedure => !!procedure['~orpc'].route.tags?.includes('admin'))

    const ping = oc.route({
      path: '/ping',
      tags: ['admin'],
    })

    const pong = oc.route({
      path: '/pong',
      tags: ['user'],
    })

    await expect(openAPIGenerator.generate({ ping, pong }, { exclude })).resolves.toEqual({
      openapi: '3.1.1',
      info: { title: 'API Reference', version: '0.0.0' },
      paths: {
        '/pong': expect.any(Object),
      },
    })

    expect(exclude).toHaveBeenCalledTimes(2)
    expect(exclude).toHaveBeenNthCalledWith(1, ping, ['ping'])
    expect(exclude).toHaveBeenNthCalledWith(2, pong, ['pong'])
  })

  describe('generator - commonSchemas', async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [
        new ZodToJsonSchemaConverter(),
      ],
    })

    const User = z.object({
      id: z.string(),
      get parent() {
        return User.optional()
      },
    })

    const Pet = z.object({
      id: z.string().transform(v => Number(v)).pipe(z.number().min(0).max(100)),
    })

    const Params = z.object({
      pet: Pet,
    })

    const Query = z.object({
      user: User,
    })

    const Headers = z.object({
      user: User,
    })

    const InputDetailedStructure = z.object({
      params: Params,
      query: Query,
      headers: Headers,
      body: User,
    })

    const OutputDetailedStructure = z.union([
      z.object({
        status: z.literal(200),
        headers: Headers,
        body: User,
      }),
      z.object({
        status: z.literal(201),
        body: User,
      }),
    ])

    const spec = await generator.generate({
      user: oc.input(User).errors({ TEST: { data: User } }).output(User),
      pet: oc.input(Pet).errors({ TEST: { data: Pet } }).output(Pet),
      iterator: oc.input(eventIterator(User, Pet)).output(eventIterator(User, Pet)),
      dynamicParams: oc.route({ path: '/user/{id}', method: 'POST' }).input(User),
      detailedStructure: oc.route({ path: '/detailed/{pet}', inputStructure: 'detailed', outputStructure: 'detailed' })
        .input(InputDetailedStructure)
        .output(OutputDetailedStructure),
      getWithoutParams: oc.route({ method: 'GET' }).input(Query),
    }, {
      commonSchemas: {
        User: {
          schema: User,
        },
        Pet: {
          strategy: 'output',
          schema: Pet,
        },
        DetailedStructure: {
          strategy: 'output',
          schema: InputDetailedStructure,
        },
        Params: {
          strategy: 'output',
          schema: Params,
        },
        Query: {
          schema: Query,
        },
        Headers: {
          strategy: 'output',
          schema: Headers,
        },
        OutputDetailedStructure: {
          schema: OutputDetailedStructure,
        },
        UndefinedError2: {
          error: 'UndefinedError',
        },
      },
    })

    it('fill correct components.schemas', async () => {
      expect(spec.components).toEqual({
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              parent: { $ref: '#/components/schemas/User' },
            },
            required: ['id'],
          },
          Pet: {
            type: 'object',
            properties: {
              id: { type: 'number', minimum: 0, maximum: 100 },
            },
            required: ['id'],
          },
          Params: {
            type: 'object',
            properties: {
              pet: { $ref: '#/components/schemas/Pet' },
            },
            required: ['pet'],
          },
          Query: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
            },
            required: ['user'],
          },
          Headers: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
            },
            required: ['user'],
          },
          DetailedStructure: {
            type: 'object',
            properties: {
              params: { $ref: '#/components/schemas/Params' },
              query: { $ref: '#/components/schemas/Query' },
              headers: { $ref: '#/components/schemas/Headers' },
              body: { $ref: '#/components/schemas/User' },
            },
            required: ['params', 'query', 'headers', 'body'],
          },
          OutputDetailedStructure: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  status: { const: 200 },
                  headers: { $ref: '#/components/schemas/Headers' },
                  body: { $ref: '#/components/schemas/User' },
                },
                required: ['status', 'headers', 'body'],
              },
              {
                type: 'object',
                properties: {
                  status: { const: 201 },
                  body: { $ref: '#/components/schemas/User' },
                },
                required: ['status', 'body'],
              },
            ],
          },
          UndefinedError2: {
            type: 'object',
            properties: {
              defined: { const: false },
              code: { type: 'string' },
              status: { type: 'number' },
              message: { type: 'string' },
              data: {},
            },
            required: ['defined', 'code', 'status', 'message'],
          },
        },
      })
    })

    it('works with schema that input & output is same + error', async () => {
      expect(spec.paths!['/user']).toEqual({
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
            required: true,
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            500: {
              description: '500',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          defined: { const: true },
                          code: { const: 'TEST' },
                          status: { const: 500 },
                          message: { type: 'string', default: 'TEST' },
                          data: { $ref: '#/components/schemas/User' },
                        },
                        required: ['defined', 'code', 'status', 'message', 'data'],
                      },
                      {
                        $ref: '#/components/schemas/UndefinedError2',
                      },
                    ],
                  },
                },
              },
            },
          },
          operationId: 'user',
        },
      })
    })

    it('works with schema that input & output is different + error', async () => {
      expect(spec.paths!['/pet']).toEqual({
        post: {
          operationId: 'pet',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                  required: ['id'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            500: {
              description: '500',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          defined: { const: true },
                          code: { const: 'TEST' },
                          status: { const: 500 },
                          message: { type: 'string', default: 'TEST' },
                          data: { $ref: '#/components/schemas/Pet' },
                        },
                        required: ['defined', 'code', 'status', 'message', 'data'],
                      },
                      {
                        $ref: '#/components/schemas/UndefinedError2',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      })
    })

    it('works with event iterator', async () => {
      expect(spec.paths!['/iterator']).toEqual({
        post: {
          operationId: 'iterator',
          requestBody: {
            required: true,
            content: {
              'text/event-stream': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'message' },
                        data: { $ref: '#/components/schemas/User' },
                        id: { type: 'string' },
                        retry: { type: 'number' },
                      },
                      required: ['event', 'data'],
                    },
                    {
                      type: 'object',
                      properties: {
                        event: { const: 'done' },
                        data: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                          },
                          required: ['id'],
                        },
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
                          data: { $ref: '#/components/schemas/User' },
                          id: { type: 'string' },
                          retry: { type: 'number' },
                        },
                        required: ['event', 'data'],
                      },
                      {
                        type: 'object',
                        properties: {
                          event: { const: 'done' },
                          data: { $ref: '#/components/schemas/Pet' },
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
        },
      })
    })

    it('works with compact + dynamic params', async () => {
      expect(spec.paths!['/user/{id}']).toEqual({
        post: {
          operationId: 'dynamicParams',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    parent: { $ref: '#/components/schemas/User' },
                  },
                  required: [],
                },
              },
            },
            required: false,
          },
          responses: expect.any(Object),
        },
      })
    })

    it('works with complex detailed structure', async () => {
      expect(spec.paths!['/detailed/{pet}']).toEqual({
        post: {
          operationId: 'detailedStructure',
          parameters: [
            {
              name: 'pet',
              in: 'path',
              required: true,
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                },
                required: ['id'],
              },
            },
            {
              name: 'user',
              in: 'query',
              required: true,
              schema: { $ref: '#/components/schemas/User' },
              style: 'deepObject',
              allowEmptyValue: true,
              allowReserved: true,
              explode: true,
            },
            {
              name: 'user',
              in: 'header',
              required: true,
              schema: { $ref: '#/components/schemas/User' },
            },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/User',
                },
              },
            },
            required: true,
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/User',
                  },
                },
              },
              headers: {
                user: {
                  required: true,
                  schema: {
                    $ref: '#/components/schemas/User',
                  },
                },
              },
            },
            201: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/User',
                  },
                },
              },
            },
          },
        },
      })
    })

    it('work with method=GET, inputStructure=compact, and without params', async () => {
      expect(spec.paths!['/getWithoutParams']).toEqual({
        get: {
          operationId: 'getWithoutParams',
          parameters: [
            {
              allowEmptyValue: true,
              allowReserved: true,
              name: 'user',
              in: 'query',
              explode: true,
              required: true,
              schema: {
                $ref: '#/components/schemas/User',
              },
              style: 'deepObject',
            },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    anyOf: [
                      {},
                      { not: {} },
                    ],
                  },
                },
              },
            },
          },
        },
      })
    })
  })

  it('customErrorResponseBodySchema', async () => {
    const openAPIGenerator = new OpenAPIGenerator({
      schemaConverters: [
        new ZodToJsonSchemaConverter(),
      ],
    })

    const router = {
      ping: oc.errors({
        BAD_REQUEST: {
          data: z.string().describe('data_BAD_REQUEST'),
        },
        BAD_REQUEST_2: {
          status: 400,
          message: 'message_BAD_REQUEST_2',
        },
        NOT_FOUND: {},
      }),
      pong: oc.route({ method: 'GET', path: '/pong' }).errors({
        INTERNAL_SERVER_ERROR: {
          message: 'message_INTERNAL_SERVER_ERROR',
          data: z.string().describe('data_BAD_REQUEST_2'),
        },
      }),
    }

    let time = 1
    const customErrorResponseBodySchema = vi.fn(() => {
      if (time++ === 3) {
        return null // fallback to default
      }

      return ({ type: 'object', description: 'custom' })
    })
    const spec = await openAPIGenerator.generate(router, {
      customErrorResponseBodySchema,
    })

    expect(customErrorResponseBodySchema).toHaveBeenCalledTimes(3)
    expect(customErrorResponseBodySchema).toHaveBeenNthCalledWith(1, [
      ['BAD_REQUEST', 'Bad Request', true, { description: 'data_BAD_REQUEST', type: 'string' }],
      ['BAD_REQUEST_2', 'message_BAD_REQUEST_2', false, { }],
    ], 400)
    expect(customErrorResponseBodySchema).toHaveBeenNthCalledWith(2, [
      ['NOT_FOUND', 'Not Found', false, { }],
    ], 404)
    expect(customErrorResponseBodySchema).toHaveBeenNthCalledWith(3, [
      ['INTERNAL_SERVER_ERROR', 'message_INTERNAL_SERVER_ERROR', true, { description: 'data_BAD_REQUEST_2', type: 'string' }],
    ], 500)

    expect(spec).toEqual({
      openapi: '3.1.1',
      info: {
        title: 'API Reference',
        version: '0.0.0',
      },
      paths: {
        '/ping': {
          post: {
            operationId: 'ping',
            responses: {
              200: expect.any(Object),
              400: { description: '400', content: { 'application/json': { schema: customErrorResponseBodySchema.mock.results[0]!.value } } },
              404: { description: '404', content: { 'application/json': { schema: customErrorResponseBodySchema.mock.results[1]!.value } } },
            },
          },
        },
        '/pong': {
          get: {
            operationId: 'pong',
            responses: {
              200: expect.any(Object),
              500: { description: '500', content: { 'application/json': {
                schema: expect.toSatisfy((schema) => { // default behavior
                  expect(schema).not.toEqual(customErrorResponseBodySchema.mock.results[2]!.value)

                  expect(schema).toEqual({ oneOf: expect.any(Array) })

                  return true
                }),
              } } },
            },
          },
        },
      },
    })
  })
})
