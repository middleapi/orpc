import { oc } from '@orpc/contract'
import z from 'zod'
import { zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator multiple status response', () => {
  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

  it('uses successStatus and successDescription when detailed outputs omit the status field', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({
          outputStructure: 'detailed',
          successStatus: 226,
          successDescription: 'IM Used',
        }))
        .output(z.object({
          body: z.object({ ok: z.boolean() }),
        })),
    })

    expect(doc.paths?.['/createPlanet']?.post?.responses).toEqual({
      226: expect.objectContaining({
        description: 'IM Used',
      }),
    })
  })

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
