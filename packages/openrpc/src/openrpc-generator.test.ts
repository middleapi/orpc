import { eventIterator, oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { z } from 'zod'
import { openrpc } from './meta'
import { OpenRPCGenerator, OpenRPCGeneratorError } from './openrpc-generator'

const planet = z.object({ id: z.number(), name: z.string() }).meta({ id: 'Planet' })

const router = {
  planet: {
    list: oc
      .meta(openapi({ summary: 'List planets', description: 'Newest first', tags: ['planets'], deprecated: true }))
      .input(z.object({ limit: z.number().optional(), cursor: z.string().describe('Page cursor') }))
      .output(z.array(planet)),
    find: oc
      .errors({
        NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) },
        BAD_GATEWAY: {},
        SERVICE_UNAVAILABLE: {},
      })
      .input(z.number())
      .output(planet.optional()),
    filter: oc.input(z.object({ name: z.string().optional() }).optional()),
    lookup: oc.input(z.object({ id: z.number() }).optional()),
    record: oc.input(z.record(z.string(), z.number())),
    ping: oc,
    void: oc.input(z.void()).output(z.void()),
    events: oc.output(eventIterator(z.string())),
  },
}

describe('openRPCGenerator', () => {
  const generator = new OpenRPCGenerator()

  it('generates an OpenRPC document', async () => {
    const doc = await generator.generate(router, {
      base: { info: { title: 'Planets', version: '1.0.0' }, servers: [{ url: 'https://example.com/rpc' }] },
    })

    expect(doc).toEqual({
      openrpc: '1.3.2',
      info: { title: 'Planets', version: '1.0.0' },
      servers: [{ url: 'https://example.com/rpc' }],
      methods: [
        {
          name: 'planet.list',
          summary: 'List planets',
          description: 'Newest first',
          deprecated: true,
          tags: [{ name: 'planets' }],
          paramStructure: 'by-name',
          params: [
            { name: 'cursor', description: 'Page cursor', required: true, schema: { type: 'string', description: 'Page cursor' } },
            { name: 'limit', schema: { type: 'number' } },
          ],
          result: { name: 'result', schema: { type: 'array', items: { $ref: '#/components/schemas/Planet' } } },
        },
        {
          name: 'planet.find',
          paramStructure: 'by-position',
          params: [{ name: 'input', required: true, schema: { type: 'number' } }],
          result: { name: 'result', schema: { anyOf: [{ $ref: '#/components/schemas/Planet' }, { type: 'null' }] } },
          errors: [
            { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true } },
            { code: -32603, message: 'Bad Gateway (BAD_GATEWAY) or Service Unavailable (SERVICE_UNAVAILABLE)' },
          ],
        },
        {
          name: 'planet.filter',
          paramStructure: 'by-name',
          params: [{ name: 'name', schema: { type: 'string' } }],
          result: { name: 'result', schema: {} },
        },
        {
          name: 'planet.lookup',
          paramStructure: 'by-position',
          params: [{ name: 'input', schema: expect.objectContaining({ type: 'object' }) }],
          result: { name: 'result', schema: {} },
        },
        {
          name: 'planet.record',
          paramStructure: 'by-position',
          params: [{ name: 'input', required: true, schema: expect.objectContaining({ type: 'object', additionalProperties: { type: 'number' } }) }],
          result: { name: 'result', schema: {} },
        },
        { name: 'planet.ping', params: [], result: { name: 'result', schema: {} } },
        { name: 'planet.void', params: [], result: { name: 'result', schema: {} } },
      ],
      components: {
        schemas: { Planet: expect.objectContaining({ type: 'object', required: ['id', 'name'] }) },
      },
    })
  })

  it('uses the error code map, filter and base document', async () => {
    const doc = await generator.generate(router, {
      base: { methods: [{ name: 'custom', params: [] }], components: { schemas: { Shared: { type: 'string' } } } },
      filter: (_, path) => path.at(-1) === 'find',
      errorCodeMap: { NOT_FOUND: 404 },
    })

    expect(doc.info).toEqual({ title: 'API Reference', version: '0.0.0' })
    expect(doc.methods.map(method => 'name' in method && method.name)).toEqual(['custom', 'planet.find'])
    expect(doc.methods[1]).toMatchObject({ errors: [{ code: 404 }, { code: -32000 }] })
    expect(Object.keys(doc.components!.schemas!)).toEqual(['Shared', 'Planet'])
  })

  it('applies openrpc meta', async () => {
    const examples = [{ name: 'earth', input: { id: 1 }, output: 'Earth' }, { name: 'no result', input: { id: 2 } }]
    const doc = await generator.generate({
      byName: oc
        .meta(openapi({ summary: 'OpenAPI summary', description: 'OpenAPI description', tags: ['openapi'] }))
        .meta(openrpc({ summary: 'Find a planet', tags: ['planets'], externalDocs: { url: 'https://example.com' }, examples }))
        .input(z.object({ id: z.number() })),
      byPosition: oc.meta(openrpc({ examples: [{ name: 'one', input: 1 }] })).input(z.number()),
      replaced: oc.meta(openrpc({ spec: { name: 'custom', params: [] } })),
      transformed: oc.meta(openrpc({ spec: method => ({ ...method, summary: 'Transformed' }) })),
    })

    expect(doc.methods).toEqual([
      expect.objectContaining({
        name: 'byName',
        summary: 'Find a planet',
        description: 'OpenAPI description',
        tags: [{ name: 'planets' }],
        externalDocs: { url: 'https://example.com' },
        examples: [
          { name: 'earth', params: [{ name: 'id', value: 1 }], result: { name: 'result', value: 'Earth' } },
          { name: 'no result', params: [{ name: 'id', value: 2 }] },
        ],
      }),
      expect.objectContaining({ name: 'byPosition', examples: [{ name: 'one', params: [{ name: 'input', value: 1 }] }] }),
      { name: 'custom', params: [] },
      expect.objectContaining({ name: 'transformed', summary: 'Transformed', result: { name: 'result', schema: {} } }),
    ])
  })

  it('works with routers and gives components valid names', async () => {
    const doc = await generator.generate({
      ping: os.input(z.object({ planet: planet.meta({ id: 'Solar System/Planet' }) })).handler(() => {}),
    })

    expect(doc.methods[0]).toMatchObject({ params: [{ name: 'planet', schema: { $ref: '#/components/schemas/Solar_System_Planet' } }] })
  })

  it('reports procedures it cannot describe', async () => {
    const generate = generator.generate({
      'rpc': { discover: oc },
      'a.b': oc,
      'upload': oc.input(z.file()),
    })

    await expect(generate).rejects.toThrow(OpenRPCGeneratorError)
    await expect(generate).rejects.toThrow(/rpc\.discover[\s\S]*a\.b[\s\S]*upload: File\/Blob schemas cannot be sent over JSON-RPC/)
    await expect(generator.generate(oc)).rejects.toThrow('Procedure at (root)')
  })
})
