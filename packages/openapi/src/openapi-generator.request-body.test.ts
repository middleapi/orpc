import { asyncIteratorObject, oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator request body', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  it('omits the request body when the procedure has no input schema', async () => {
    const doc = await generator.generate({
      ping: oc.meta(openapi({ method: 'POST' })),
    })

    expect(doc.paths?.['/ping']?.post).toBeDefined()
    expect(doc.paths?.['/ping']?.post?.requestBody).toBeUndefined()
  })

  it('treats boolean input schemas as unconstrained', async () => {
    const doc = await generator.generate({
      ping: oc.meta(openapi({ method: 'POST' })).input(testSchema(true)),
    })

    expect(doc.paths?.['/ping']?.post?.requestBody).toBeUndefined()
  })

  it('keeps merged request bodies optional when every input schema is optional', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ method: 'POST', path: '/planets' }))
        .input(z.looseObject({ name: z.string() }).optional())
        .input(z.looseObject({ note: z.string() }).optional()),
    })

    expect(doc.paths?.['/planets']).toEqual({
      post: expect.objectContaining({
        requestBody: {
          content: {
            'application/json': {
              schema: expect.objectContaining({
                allOf: expect.any(Array),
              }),
            },
          },
        },
      }),
    })
  })

  it('omits both query parameters and request body for HEAD procedures', async () => {
    const doc = await generator.generate({
      checkPlanet: oc
        .meta(openapi({ method: 'HEAD', path: '/planets/{id}' }))
        .input(z.object({ id: z.string(), verbose: z.boolean() })),
    })

    expect(doc.paths?.['/planets/{id}']?.head).toEqual(expect.objectContaining({
      parameters: [
        expect.objectContaining({ name: 'id', in: 'path' }),
      ],
    }))
    expect(doc.paths?.['/planets/{id}']?.head?.requestBody).toBeUndefined()
  })

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

  it('marks the request body optional when every non-param field is optional', async () => {
    const doc = await generator.generate({
      updatePlanet: oc
        .meta(openapi({ method: 'POST', path: '/planets/{id}' }))
        .input(z.object({
          id: z.string(),
          name: z.string().optional(),
          note: z.string().optional(),
        })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      post: expect.objectContaining({
        parameters: [
          expect.objectContaining({ name: 'id', in: 'path' }),
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: expect.objectContaining({
                type: 'object',
                properties: {
                  name: expect.objectContaining({ type: 'string' }),
                  note: expect.objectContaining({ type: 'string' }),
                },
              }),
            },
          },
        },
      }),
    })
  })

  it('maps request bodies from any schema via custom converters', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ method: 'POST', path: '/planets' }))
        .input(testSchema({
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            mass: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['name'],
        })),
    })

    expect(doc.paths?.['/planets']).toEqual({
      post: expect.objectContaining({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 1 },
                  mass: { type: 'number', exclusiveMinimum: 0 },
                },
                required: ['name'],
              },
            },
          },
        },
      }),
    })
  })

  describe('with files', () => {
    it.each(['compact', 'detailed'] as const)('maps %s request bodies as files', async (inputStructure) => {
      const file = z.file().mime(['application/pdf', 'application/xml'])

      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets',
            inputStructure,
          }))
          .input(inputStructure === 'compact' ? file : z.object({ body: file })),
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

    it.each(['compact', 'detailed'] as const)('maps %s request bodies as files without mime', async (inputStructure) => {
      const file = z.file()

      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets',
            inputStructure,
          }))
          .input(inputStructure === 'compact' ? file : z.object({ body: file })),
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

    it.each(['compact', 'detailed'] as const)('maps %s request bodies with nested files', async (inputStructure) => {
      const body = z.object({ file: z.file().mime(['application/pdf', 'application/xml']) })

      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({
            method: 'POST',
            path: '/planets',
            inputStructure,
          }))
          .input(inputStructure === 'compact' ? body : z.object({ body })),
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

    it('splits mixed unions of files and json bodies into separate content types', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ method: 'POST', path: '/planets' }))
          .input(z.union([
            z.file().mime('application/pdf'),
            z.object({ name: z.string() }),
          ])),
      })

      expect(doc.paths?.['/planets']?.post?.requestBody).toEqual({
        required: true,
        content: {
          'application/json': {
            schema: expect.objectContaining({
              type: 'object',
              properties: {
                name: expect.objectContaining({ type: 'string' }),
              },
            }),
          },
          'application/pdf': {
            schema: expect.objectContaining({
              contentEncoding: 'binary',
            }),
          },
        },
      })
    })

    it('merges file schemas sharing the json content type into the json media entry', async () => {
      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ method: 'POST', path: '/planets' }))
          .input(z.union([
            z.file().mime('application/json'),
            z.object({ name: z.string() }),
          ])),
      })

      expect(doc.paths?.['/planets']?.post?.requestBody).toEqual({
        required: true,
        content: {
          'application/json': {
            schema: {
              anyOf: [
                expect.objectContaining({
                  type: 'object',
                  properties: {
                    name: expect.objectContaining({ type: 'string' }),
                  },
                }),
                expect.objectContaining({
                  contentEncoding: 'binary',
                }),
              ],
            },
          },
        },
      })
    })

    it('maps file request bodies from any schema via custom converters', async () => {
      const doc = await generator.generate({
        uploadMap: oc
          .meta(openapi({ method: 'POST', path: '/maps' }))
          .input(testSchema({
            type: 'string',
            contentMediaType: 'image/png',
            contentEncoding: 'binary',
          })),
      })

      expect(doc.paths?.['/maps']).toEqual({
        post: expect.objectContaining({
          requestBody: {
            required: true,
            content: {
              'image/png': {
                schema: expect.objectContaining({
                  contentEncoding: 'binary',
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

  it('maps AsyncIteratorObject inputs without a return schema', async () => {
    const doc = await generator.generate({
      subscribe: oc
        .meta(openapi({}))
        .input(asyncIteratorObject(z.string())),
    })

    expect(doc.paths?.['/subscribe']?.post?.requestBody).toEqual({
      content: {
        'text/event-stream': {
          schema: expect.objectContaining({
            oneOf: expect.arrayContaining([
              expect.objectContaining({
                properties: expect.objectContaining({
                  event: { const: 'message' },
                  data: { type: 'string' },
                }),
                required: ['event', 'data'],
              }),
              expect.objectContaining({
                properties: expect.objectContaining({
                  event: { const: 'close' },
                }),
                required: ['event'],
              }),
            ]),
          }),
        },
      },
      required: true,
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
