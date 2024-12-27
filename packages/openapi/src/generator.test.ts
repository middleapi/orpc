import type { OpenAPIObject } from 'openapi3-ts/oas31'
import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { oz } from '@orpc/zod'
import OpenAPIParser from '@readme/openapi-parser'
import { z } from 'zod'
import { generateOpenAPI } from './generator'

it('works', async () => {
  const o = oc

  const router = o.router({
    ping: o.output(z.string()),

    user: {
      find: o
        .route({ method: 'GET', path: '/users/{id}', tags: ['user'] })
        .input(z.object({ id: z.string() }))
        .output(z.object({ name: z.string() })),
    },
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toMatchObject({
    openapi: '3.1.0',
    info: {
      title: 'test',
      version: '1.0.0',
    },
    paths: {
      '/ping': {
        post: {
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
        },
      },
      '/users/{id}': {
        get: {
          tags: ['user'],
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
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: {
                        type: 'string',
                      },
                    },
                    required: ['name'],
                  },
                },
              },
            },
          },
        },
      },
    },
  } satisfies OpenAPIObject)
})

it('throwOnMissingTagDefinition option', async () => {
  const o = oc

  const router = o.router({
    ping: o.output(z.string()),

    user: {
      find: o
        .route({ method: 'GET', path: '/users/{id}', tags: ['user'] })
        .input(z.object({ id: z.string() }))
        .output(z.object({ name: z.string() })),
    },
  })

  const spec = await generateOpenAPI(
    {
      router,
      info: {
        title: 'test',
        version: '1.0.0',
      },
      tags: [
        {
          name: 'user',
          description: 'User related apis',
        },
      ],
    },
    { throwOnMissingTagDefinition: true },
  )

  await OpenAPIParser.validate(spec as any)

  expect(spec).toMatchObject({
    openapi: '3.1.0',
    info: {
      title: 'test',
      version: '1.0.0',
    },
    tags: [
      {
        name: 'user',
        description: 'User related apis',
      },
    ],
    paths: {
      '/ping': {
        post: {
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
        },
      },
      '/users/{id}': {
        get: {
          tags: ['user'],
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
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: {
                        type: 'string',
                      },
                    },
                    required: ['name'],
                  },
                },
              },
            },
          },
        },
      },
    },
  } satisfies OpenAPIObject)

  expect(generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  }, { throwOnMissingTagDefinition: true }))
    .rejects
    .toThrowError('Tag "user" is missing definition. Please define it in OpenAPI root tags object. [user.find]')
})

it('support single file upload', async () => {
  const o = oc

  const router = o.router({
    upload: o
      .input(z.union([z.string(), oz.file()]))
      .output(
        z.union([oz.file().type('image/jpg'), oz.file().type('image/png')]),
      ),
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toMatchObject({
    paths: {
      '/upload': {
        post: {
          requestBody: {
            content: {
              '*/*': {
                schema: {
                  type: 'string',
                  contentMediaType: '*/*',
                },
              },
              'application/json': {
                schema: {
                  type: 'string',
                },
              },
            },
          },
          responses: {
            200: {
              content: {
                'image/jpg': {
                  schema: {
                    type: 'string',
                    contentMediaType: 'image/jpg',
                  },
                },
                'image/png': {
                  schema: {
                    type: 'string',
                    contentMediaType: 'image/png',
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

it('support multipart/form-data', async () => {
  const o = oc

  const router = o.router({
    resize: o
      .input(
        z.object({
          file: oz.file().type('image/*'),
          height: z.number(),
          width: z.number(),
        }),
      )
      .output(oz.file().type('image/*')),
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  expect(spec).toMatchObject({
    paths: {
      '/resize': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      contentMediaType: 'image/*',
                    },
                    height: {
                      type: 'number',
                    },
                    width: {
                      type: 'number',
                    },
                  },
                  required: ['file', 'height', 'width'],
                },
              },
            },
          },
          responses: {
            200: {
              content: {
                'image/*': {
                  schema: {
                    type: 'string',
                    contentMediaType: 'image/*',
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

it('work with example', async () => {
  const router = oc.router({
    upload: oc
      .input(
        z.object({
          set: z.set(z.string()),
          map: z.map(z.string(), z.number()),
        }),
        {
          set: new Set(['a', 'b', 'c']),
          map: new Map([
            ['a', 1],
            ['b', 2],
            ['c', 3],
          ]),
        },
      )
      .output(
        z.object({
          set: z.set(z.string()),
          map: z.map(z.string(), z.number()),
        }),
        {
          set: new Set(['a', 'b', 'c']),
          map: new Map([
            ['a', 1],
            ['b', 2],
            ['c', 3],
          ]),
        },
      ),
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toMatchObject({
    paths: {
      '/upload': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    set: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    map: {
                      type: 'array',
                      items: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        maxItems: 2,
                        minItems: 2,
                      },
                    },
                  },
                  required: ['set', 'map'],
                },
                example: {
                  set: ['a', 'b', 'c'],
                  map: [
                    ['a', 1],
                    ['b', 2],
                    ['c', 3],
                  ],
                },
              },
            },
          },
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      set: {
                        type: 'array',
                        items: {
                          type: 'string',
                        },
                      },
                      map: {
                        type: 'array',
                        items: {
                          type: 'array',
                          prefixItems: [
                            {
                              type: 'string',
                            },
                            {
                              type: 'number',
                            },
                          ],
                          maxItems: 2,
                          minItems: 2,
                        },
                      },
                    },
                    required: ['set', 'map'],
                  },
                  example: {
                    set: ['a', 'b', 'c'],
                    map: [
                      ['a', 1],
                      ['b', 2],
                      ['c', 3],
                    ],
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

it('should remove params on body', async () => {
  const router = oc.router({
    upload: oc.route({ method: 'POST', path: '/upload/{id}' }).input(
      oz.openapi(
        z.object({
          id: z.number(),
          file: z.string().url(),
        }),
        {
          examples: [
            {
              id: 123,
              file: 'https://example.com/file.png',
            },
          ],
        },
      ),
    ),
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toEqual({
    info: { title: 'test', version: '1.0.0' },
    openapi: '3.1.0',
    paths: {
      '/upload/{id}': {
        post: {
          summary: undefined,
          description: undefined,
          deprecated: undefined,
          tags: undefined,
          operationId: 'upload',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { examples: [123], type: 'number' },
              example: undefined,
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'uri' } },
                  required: ['file'],
                  examples: [{ file: 'https://example.com/file.png' }],
                },
                example: undefined,
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: {}, example: undefined },
              },
            },
          },
        },
      },
    },
  })
})

it('should remove params on query', async () => {
  const router = oc.router({
    upload: oc.route({ method: 'GET', path: '/upload/{id}' }).input(
      oz.openapi(
        z.object({
          id: z.number(),
          file: z.string().url(),
          object: z
            .object({
              name: z.string(),
            })
            .optional(),
        }),
        {
          examples: [
            {
              id: 123,
              file: 'https://example.com/file.png',
              object: { name: 'test' },
            },
            {
              id: 456,
              file: 'https://example.com/file2.png',
            },
          ],
        },
      ),
    ),
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toEqual({
    info: { title: 'test', version: '1.0.0' },
    openapi: '3.1.0',
    paths: {
      '/upload/{id}': {
        get: {
          summary: undefined,
          description: undefined,
          deprecated: undefined,
          tags: undefined,
          operationId: 'upload',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { examples: [123, 456], type: 'number' },
              example: undefined,
            },
            {
              name: 'file',
              in: 'query',
              style: 'deepObject',
              required: true,
              schema: {
                examples: [
                  'https://example.com/file.png',
                  'https://example.com/file2.png',
                ],
                type: 'string',
                format: 'uri',
              },
              example: undefined,
            },
            {
              name: 'object',
              in: 'query',
              style: 'deepObject',
              required: false,
              schema: {
                examples: [{ name: 'test' }],
                anyOf: undefined,
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
              example: undefined,
            },
          ],
          requestBody: undefined,
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: {}, example: undefined },
              },
            },
          },
        },
      },
    },
  })
})

it('works with lazy', async () => {
  const ping = os.input(z.string()).output(z.string()).handler(() => 'pong')

  const lazyRouter = os.lazy(() => Promise.resolve({ default: {
    ping,
  } }))

  const router = os.router({
    ping,
    lazyRouter,
  })

  const spec = await generateOpenAPI({
    router,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toMatchObject({
    openapi: '3.1.0',
    info: {
      title: 'test',
      version: '1.0.0',
    },
    paths: {
      '/ping': {
        post: {
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
        },
      },
      '/lazyRouter/ping': {
        post: {
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
        },
      },
    },
  } satisfies OpenAPIObject)
})

it('works will use contract instead of implemented', async () => {
  const contract = oc.router({
    ping: oc.route({ path: '/contract' }),
  })

  const implemented = os.contract(contract).router({
    ping: os.route({ path: '/implemented' }).handler(() => 'pong'),
  })

  const spec = await generateOpenAPI({
    router: implemented,
    info: {
      title: 'test',
      version: '1.0.0',
    },
  })

  await OpenAPIParser.validate(spec as any)

  expect(spec).toMatchObject({
    openapi: '3.1.0',
    info: {
      title: 'test',
      version: '1.0.0',
    },
    paths: {
      '/contract': {
        post: {
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {},
                },
              },
            },
          },
        },
      },
    },
  } satisfies OpenAPIObject)
})
