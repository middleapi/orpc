import { oc } from '@orpc/contract'
import z from 'zod'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator request params', () => {
  const generator = new OpenAPIGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

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

  it('maps path params from any schema via custom converters', async () => {
    const doc = await generator.generate({
      getPlanet: oc
        .meta(openapi({ method: 'GET', path: '/planets/{id}' }))
        .input(testSchema({
          type: 'object',
          properties: { id: { type: 'integer', minimum: 1 } },
          required: ['id'],
        })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      get: expect.objectContaining({
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 1 },
          },
        ],
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
      name: 'compact input missing a dynamic param key',
      procedure: oc.meta(openapi({ path: '/planets/{id}' })).input(z.object({
        other: z.string(),
      })),
      message: 'Procedure at path "test" is missing dynamic param "id" in its input schema.',
    },
    {
      name: 'detailed input missing a dynamic param key',
      procedure: oc.meta(openapi({ inputStructure: 'detailed', path: '/{id}' })).input(z.object({
        params: z.object({ other: z.string() }),
      })),
      message: 'Procedure at path "test" is missing dynamic param "id" in its input schema.',
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
