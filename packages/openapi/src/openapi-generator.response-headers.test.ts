import { oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator response headers', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

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

  it('omits required for optional response headers', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ outputStructure: 'detailed' }))
        .output(z.object({
          headers: z.object({ 'x-optional-id': z.string().optional() }),
        })),
    })

    expect(doc.paths?.['/createPlanet']).toEqual({
      post: expect.objectContaining({
        responses: {
          200: {
            description: 'OK',
            headers: {
              'x-optional-id': {
                schema: expect.objectContaining({ type: 'string' }),
              },
            },
          },
        },
      }),
    })
  })

  it('maps response headers from any schema via custom converters', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ outputStructure: 'detailed' }))
        .output(testSchema({
          type: 'object',
          properties: {
            headers: {
              type: 'object',
              properties: {
                'x-rate-limit': { type: 'integer' },
              },
              required: ['x-rate-limit'],
            },
          },
          required: ['headers'],
        })),
    })

    expect(doc.paths?.['/createPlanet']).toEqual({
      post: expect.objectContaining({
        responses: {
          200: {
            description: 'OK',
            headers: {
              'x-rate-limit': {
                required: true,
                schema: { type: 'integer' },
              },
            },
          },
        },
      }),
    })
  })
})
