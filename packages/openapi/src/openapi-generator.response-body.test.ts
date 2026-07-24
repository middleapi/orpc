import { asyncIteratorObject, oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator response body', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  it('creates a success response without content when the procedure has no output schema', async () => {
    const doc = await generator.generate({
      ping: oc.meta(openapi({})),
    })

    expect(doc.paths?.['/ping']?.post?.responses).toEqual({
      200: {
        description: 'OK',
        content: {},
      },
    })
  })

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

  it('maps response bodies from any schema via custom converters', async () => {
    const doc = await generator.generate({
      getPlanet: oc
        .meta(openapi({}))
        .output(testSchema({
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        })),
    })

    expect(doc.paths?.['/getPlanet']?.post?.responses).toEqual({
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { id: { type: 'string', format: 'uuid' } },
              required: ['id'],
            },
          },
        },
      },
    })
  })

  describe('with files', () => {
    it.each(['compact', 'detailed'] as const)('maps %s response bodies as files', async (outputStructure) => {
      const file = z.file().mime(['application/pdf', 'application/xml'])

      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ outputStructure }))
          .output(outputStructure === 'compact' ? file : z.object({ body: file })),
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

    it.each(['compact', 'detailed'] as const)('maps %s response bodies as files without mime', async (outputStructure) => {
      const file = z.file()

      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ outputStructure }))
          .output(outputStructure === 'compact' ? file : z.object({ body: file })),
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

    it.each(['compact', 'detailed'] as const)('maps %s response bodies with nested files', async (outputStructure) => {
      const body = z.object({ file: z.file().mime(['application/pdf', 'application/xml']) })

      const doc = await generator.generate({
        createPlanet: oc
          .meta(openapi({ outputStructure }))
          .output(outputStructure === 'compact' ? body : z.object({ body })),
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
