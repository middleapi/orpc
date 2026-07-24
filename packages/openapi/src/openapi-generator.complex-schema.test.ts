import { asyncIteratorObject, oc } from '@orpc/contract'
import z from 'zod'
import { zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator complex schema', () => {
  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

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
