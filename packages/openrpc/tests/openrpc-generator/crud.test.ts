import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import z from 'zod'
import { openrpc, OpenRPCGenerator } from '../../src'
import { zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: crud api', () => {
  const generator = new OpenRPCGenerator({ converters: [zodJsonSchemaConverter] })

  const Planet = z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().optional(),
  }).meta({ id: 'Planet' })

  const router = {
    planet: {
      list: oc
        .meta(openrpc({ tags: ['planets'], summary: 'List planets' }))
        .input(z.object({ cursor: z.string().optional(), limit: z.number().optional() }).optional())
        .output(z.array(Planet)),
      find: oc
        .meta(openrpc({
          tags: ['planets'],
          summary: 'Find a planet',
          examples: [{ name: 'Earth', input: { id: 1 }, output: { id: 1, name: 'Earth' } }],
        }))
        .input(z.object({ id: z.number() }))
        .output(Planet.optional()),
      create: oc
        // documented for OpenAPI only
        .meta(openapi({ method: 'POST', path: '/planets', tags: ['planets'], summary: 'Create a planet' }))
        .input(z.object({ name: z.string(), description: z.string().optional() }))
        .output(Planet),
      update: oc
        .meta(openrpc({ tags: ['planets'] }))
        .input(z.object({ id: z.number(), name: z.string().optional(), description: z.string().optional() }))
        .output(Planet),
      remove: oc
        .meta(openrpc({ tags: ['planets'], deprecated: true, description: 'Use planet.archive instead.' }))
        .input(z.number()),
    },
  }

  it('documents every procedure as a method named after its router path', async () => {
    const doc = await generator.generate(router, {
      base: {
        info: { title: 'Planet API', version: '1.0.0' },
        servers: [{ url: 'https://example.com/rpc' }],
      },
    })

    expect(doc).toEqual({
      openrpc: '1.3.2',
      info: { title: 'Planet API', version: '1.0.0' },
      servers: [{ url: 'https://example.com/rpc' }],
      methods: [
        expect.objectContaining({ name: 'planet.list', summary: 'List planets', tags: [{ name: 'planets' }] }),
        expect.objectContaining({ name: 'planet.find', summary: 'Find a planet', tags: [{ name: 'planets' }] }),
        expect.objectContaining({ name: 'planet.create' }),
        expect.objectContaining({ name: 'planet.update' }),
        expect.objectContaining({ name: 'planet.remove', deprecated: true }),
      ],
      components: {
        schemas: {
          Planet: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['id', 'name'],
            additionalProperties: false,
          },
        },
      },
    })
  })

  it('maps list inputs to by-name params that can all be omitted', async () => {
    const [list] = (await generator.generate(router)).methods

    expect(list).toEqual({
      name: 'planet.list',
      summary: 'List planets',
      tags: [{ name: 'planets' }],
      paramStructure: 'by-name',
      params: [
        { name: 'cursor', schema: { type: 'string' } },
        { name: 'limit', schema: { type: 'number' } },
      ],
      result: { name: 'result', schema: { type: 'array', items: { $ref: '#/components/schemas/Planet' } } },
    })
  })

  it('allows a null result when nothing is found, and describes examples as by-name params', async () => {
    const [, find] = (await generator.generate(router)).methods

    expect(find).toEqual({
      name: 'planet.find',
      summary: 'Find a planet',
      tags: [{ name: 'planets' }],
      paramStructure: 'by-name',
      params: [{ name: 'id', required: true, schema: { type: 'number' } }],
      result: { name: 'result', schema: { anyOf: [{ $ref: '#/components/schemas/Planet' }, { type: 'null' }] } },
      examples: [{
        name: 'Earth',
        params: [{ name: 'id', value: 1 }],
        result: { name: 'result', value: { id: 1, name: 'Earth' } },
      }],
    })
  })
})
