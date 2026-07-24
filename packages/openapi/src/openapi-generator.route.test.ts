import { oc } from '@orpc/contract'
import z from 'zod'
import { zodJsonSchemaConverter } from '../tests/__shared__/schema'
import { openapi } from './meta'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator route', () => {
  const generator = new OpenAPIGenerator({ converters: [zodJsonSchemaConverter] })

  it('derives the default path, method, and operationId from router segments', async () => {
    const doc = await generator.generate({
      admin: {
        listUsers: oc
          .input(z.object({ page: z.number().optional() }))
          .output(z.object({ users: z.array(z.string()) })),
      },
    })

    expect(doc.paths).toEqual({
      '/admin/listUsers': {
        post: expect.objectContaining({
          operationId: 'admin.listUsers',
          responses: {
            200: expect.any(Object),
          },
        }),
      },
    })
  })

  it('applies explicit metadata and prefixes', async () => {
    const doc = await generator.generate({
      getPlanet: oc
        .meta(openapi({
          method: 'GET',
          prefix: '/api/v2',
          path: '/planets/{id}',
          operationId: 'getPlanetById',
          tags: ['planets'],
          summary: 'Get a planet',
          description: 'Returns a single planet.',
          deprecated: true,
          successStatus: 206,
          successDescription: 'Planet payload',
        }))
        .input(z.object({ id: z.string() })),
    })

    expect(doc.paths?.['/api/v2/planets/{id}']).toEqual({
      get: expect.objectContaining({
        operationId: 'getPlanetById',
        tags: ['planets'],
        summary: 'Get a planet',
        description: 'Returns a single planet.',
        deprecated: true,
        parameters: [
          expect.objectContaining({
            name: 'id',
            in: 'path',
            required: true,
          }),
        ],
        responses: {
          206: expect.objectContaining({
            description: 'Planet payload',
          }),
        },
      }),
    })
  })

  it('applies the prefix to the path derived from router segments', async () => {
    const doc = await generator.generate({
      admin: {
        listUsers: oc.meta(openapi({ prefix: '/api/v1' })),
      },
    })

    expect(doc.paths).toEqual({
      '/api/v1/admin/listUsers': {
        post: expect.objectContaining({
          operationId: 'admin.listUsers',
        }),
      },
    })
  })

  it('lowercases the configured method', async () => {
    const doc = await generator.generate({
      removePlanet: oc
        .meta(openapi({ method: 'DELETE', path: '/planets/{id}' }))
        .input(z.object({ id: z.string() })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      delete: expect.objectContaining({
        operationId: 'removePlanet',
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

  it('can extends spec with openapi.spec function', async () => {
    const doc = await generator.generate({
      getPlanet: oc
        .meta(openapi({
          method: 'GET',
          path: '/planets/{id}',
          spec: current => ({
            ...current,
            'security': [{ bearerAuth: [] }],
            'x-orpc-kind': 'planet-read',
          }),
        }))
        .input(z.object({ id: z.string() })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      get: expect.objectContaining({
        'operationId': 'getPlanet',
        'security': [{ bearerAuth: [] }],
        'x-orpc-kind': 'planet-read',
        'parameters': [
          expect.objectContaining({
            name: 'id',
            in: 'path',
            required: true,
          }),
        ],
        'responses': {
          200: expect.any(Object),
        },
      }),
    })
  })

  it('can override spec with openapi.spec object', async () => {
    const doc = await generator.generate({
      getPlanet: oc
        .meta(openapi({
          method: 'GET',
          path: '/planets/{id}',
          operationId: 'getPlanetById',
          spec: {
            'operationId': 'custom.getPlanet',
            'security': [{ bearerAuth: [] }],
            'x-orpc-kind': 'planet-read',
          },
        }))
        .input(z.object({ id: z.string() })),
    })

    expect(doc.paths?.['/planets/{id}']).toEqual({
      get: {
        'operationId': 'custom.getPlanet',
        'security': [{ bearerAuth: [] }],
        'x-orpc-kind': 'planet-read',
      },
    })
  })

  it('spec object bypasses input validation errors since nothing is generated', async () => {
    const doc = await generator.generate({
      // this procedure would normally throw: GET with non-object input schema
      getPlanet: oc
        .meta(openapi({
          method: 'GET',
          spec: { operationId: 'custom.getPlanet' },
        }))
        .input(z.string()),
    })

    expect(doc.paths?.['/getPlanet']).toEqual({
      get: { operationId: 'custom.getPlanet' },
    })
  })
})
