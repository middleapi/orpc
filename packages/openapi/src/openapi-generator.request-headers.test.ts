import { oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator request headers', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

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

  it('omits required for optional request headers', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ inputStructure: 'detailed' }))
        .input(z.object({
          headers: z.object({ 'x-optional-id': z.string().optional() }),
        })),
    })

    expect(doc.paths?.['/createPlanet']).toEqual({
      post: expect.objectContaining({
        parameters: [
          {
            name: 'x-optional-id',
            in: 'header',
            schema: expect.objectContaining({ type: 'string' }),
          },
        ],
      }),
    })
  })

  it('maps request headers from any schema via custom converters', async () => {
    const doc = await generator.generate({
      createPlanet: oc
        .meta(openapi({ inputStructure: 'detailed' }))
        .input(testSchema({
          type: 'object',
          properties: {
            headers: {
              type: 'object',
              properties: {
                'x-api-version': { type: 'string', enum: ['v1', 'v2'] },
              },
              required: ['x-api-version'],
            },
          },
          required: ['headers'],
        })),
    })

    expect(doc.paths?.['/createPlanet']).toEqual({
      post: expect.objectContaining({
        parameters: [
          {
            name: 'x-api-version',
            in: 'header',
            required: true,
            schema: { type: 'string', enum: ['v1', 'v2'] },
          },
        ],
      }),
    })
  })
})
