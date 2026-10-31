import type { JsonSchemaConverter } from '@orpc/json-schema'
import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { z } from 'zod'
import { openrpc } from './meta'
import { OpenRPCGenerator, OpenRPCGeneratorError } from './openrpc-generator'

const planet = z.object({ id: z.number(), name: z.string() }).meta({ id: 'Planet' })

describe('openRPCGenerator basic & options', () => {
  const generator = new OpenRPCGenerator()

  it('starts from the default base document', async () => {
    await expect(generator.generate({})).resolves.toEqual({
      openrpc: '1.3.2',
      info: { title: 'API Reference', version: '0.0.0' },
      methods: [],
    })
  })

  it('merges the provided base document and serialize the result', async () => {
    const serializer = {
      serializeJson: vi.fn(document => ({ json: document })),
      deserializeJson: vi.fn(),
    }

    const generator = new OpenRPCGenerator({ serializer })

    const doc = await generator.generate({ ping: oc }, {
      base: {
        info: { title: 'Planet API', version: '1.2.3' },
        servers: [{ url: 'https://api.example.com/rpc' }],
        methods: [{ name: 'custom', params: [] }],
      },
    })

    const expected = {
      openrpc: '1.3.2',
      info: { title: 'Planet API', version: '1.2.3' },
      servers: [{ url: 'https://api.example.com/rpc' }],
      methods: [
        { name: 'custom', params: [] },
        { name: 'ping', params: [], result: { name: 'result', schema: {} } },
      ],
    }

    expect(serializer.serializeJson).toHaveBeenCalledWith(expected)
    expect(doc).toEqual(expected)
  })

  it('serializes non-JSON values with the default serializer', async () => {
    const doc = await generator.generate({}, {
      base: { info: { 'title': 'Planet API', 'version': '1.0.0', 'x-generated-at': new Date('2020-01-01T00:00:00.000Z') } },
    })

    expect(doc.info['x-generated-at']).toBe('2020-01-01T00:00:00.000Z')
  })

  it('does not mutate the provided base document', async () => {
    const base = {
      methods: [{ name: 'custom', params: [] }],
      components: { schemas: { Existing: { type: 'string' } as const } },
    }
    const snapshot = structuredClone(base)

    const doc = await generator.generate({ find: oc.output(planet) }, { base })

    expect(doc.methods.map(method => 'name' in method && method.name)).toEqual(['custom', 'find'])
    expect(doc.components?.schemas).toEqual({ Existing: { type: 'string' }, Planet: expect.any(Object) })
    expect(base).toEqual(snapshot)
  })

  it('invokes filter with the walked path and excludes filtered procedures', async () => {
    const publicProcedure = oc
    const privateProcedure = oc.input(z.string())

    const filter = vi.fn((procedure, path) => procedure !== privateProcedure && path.join('.') !== 'admin.private')

    const doc = await generator.generate({ public: publicProcedure, admin: { private: privateProcedure } }, { filter })

    expect(filter).toHaveBeenCalledTimes(2)
    expect(filter).toHaveBeenNthCalledWith(1, publicProcedure, ['public'])
    expect(filter).toHaveBeenNthCalledWith(2, privateProcedure, ['admin', 'private'])
    expect(doc.methods).toEqual([expect.objectContaining({ name: 'public' })])
  })

  it('names methods after router paths, in contract-first, implemented and lazy routers', async () => {
    const contract = await generator.generate({ planet: { find: oc } })
    const router = await generator.generate({
      planet: { find: os.handler(() => {}) },
      lazy: os.lazy(() => Promise.resolve({ default: { planet: { find: os.handler(() => {}) } } })),
    })

    expect(contract.methods.map(method => 'name' in method && method.name)).toEqual(['planet.find'])
    expect(router.methods.map(method => 'name' in method && method.name)).toEqual(['planet.find', 'lazy.planet.find'])
  })

  it('fallback to StandardJsonSchemaConverter', async () => {
    const condition = vi.fn(() => false)
    const generator = new OpenRPCGenerator({ converters: [{ condition, convert: vi.fn() }] })

    const doc = await generator.generate({ find: oc.input(z.object({ id: z.number() })).output(z.string()) })

    // ensure it prioritizes the provided converters
    expect(condition).toHaveBeenCalledTimes(2)
    expect(doc.methods[0]).toMatchObject({
      params: [{ name: 'id', required: true, schema: { type: 'number' } }],
      result: { name: 'result', schema: { type: 'string' } },
    })
  })

  it('converts inputs with the "input" direction and outputs with the "output" direction', async () => {
    const converter: JsonSchemaConverter = {
      condition: () => true,
      convert: (_, direction) => [{ type: 'object', properties: { [direction]: { type: 'string' } }, required: [direction] }, false],
    }

    const doc = await new OpenRPCGenerator({ converters: [converter] }).generate({ transform: oc.input(z.any()).output(z.any()) })

    expect(doc.methods[0]).toMatchObject({
      params: [{ name: 'input', required: true, schema: { type: 'string' } }],
      result: { name: 'result', schema: { type: 'object', properties: { output: { type: 'string' } }, required: ['output'] } },
    })
  })

  it('aggregates all generator errors into a single OpenRPCGeneratorError', async () => {
    const error = await generator.generate({
      'rpc': { discover: oc.meta(openrpc({ spec: { name: 'rpc.discover', params: [] } })) },
      'a.b': oc,
      'nested': { '': oc },
      'upload': oc.input(z.object({ file: z.file() })),
      'download': oc.output(z.file()),
    }).then(
      () => { throw new Error('expected generate to reject') },
      e => e,
    )

    expect(error).toBeInstanceOf(OpenRPCGeneratorError)
    expect(error.message).toContain('Failed to generate the OpenRPC document')
    expect(error.message).toContain('Procedure at rpc.discover: "rpc.discover" is not a valid method name')
    expect(error.message).toContain('Procedure at a.b: "a.b" is not a valid method name')
    expect(error.message).toContain('Procedure at nested.: "nested." is not a valid method name')
    expect(error.message).toContain('Procedure at upload: File/Blob schemas cannot be sent over JSON-RPC.')
    expect(error.message).toContain('Procedure at download: File/Blob schemas cannot be sent over JSON-RPC.')

    await expect(generator.generate(oc)).rejects.toThrow('Procedure at (root): "" is not a valid method name')
  })

  it('rethrows non-generator errors immediately without wrapping', async () => {
    const generator = new OpenRPCGenerator({
      converters: [{ condition: () => true, convert: () => { throw new Error('converter exploded') } }],
    })

    const error = await generator.generate({ ping: oc.input(z.string()) }).then(
      () => { throw new Error('expected generate to reject') },
      e => e,
    )

    expect(error).not.toBeInstanceOf(OpenRPCGeneratorError)
    expect(error.message).toBe('converter exploded')
  })
})

describe('openRPCGenerator params', () => {
  const generator = new OpenRPCGenerator()

  it('describes an object input as by-name params, required ones first', async () => {
    const doc = await generator.generate({
      list: oc.input(z.object({ limit: z.number().optional(), cursor: z.string().describe('Page cursor'), sort: z.string() })),
    })

    expect(doc.methods[0]).toEqual({
      name: 'list',
      paramStructure: 'by-name',
      params: [
        { name: 'cursor', description: 'Page cursor', required: true, schema: { type: 'string', description: 'Page cursor' } },
        { name: 'sort', required: true, schema: { type: 'string' } },
        { name: 'limit', schema: { type: 'number' } },
      ],
      result: { name: 'result', schema: {} },
    })
  })

  it('describes an optional object input by-name only when every property is optional', async () => {
    const doc = await generator.generate({
      filter: oc.input(z.object({ name: z.string().optional() }).optional()),
      lookup: oc.input(z.object({ id: z.number() }).optional()),
    })

    expect(doc.methods[0]).toMatchObject({ paramStructure: 'by-name', params: [{ name: 'name', schema: { type: 'string' } }] })
    expect(doc.methods[1]).toMatchObject({ paramStructure: 'by-position', params: [{ name: 'input', schema: { type: 'object', required: ['id'] } }] })
    expect(doc.methods[1]).not.toHaveProperty('params.0.required')
  })

  it('keeps objects with additional properties or annotations by-name', async () => {
    const doc = await generator.generate({
      loose: oc.input(z.looseObject({ id: z.number() })),
      strict: oc.input(z.strictObject({ id: z.number() })),
      described: oc.input(z.object({ id: z.number() }).describe('Lookup')),
      titled: oc.input(z.object({ id: z.number() }).meta({ 'title': 'Lookup', 'x-internal': true })),
    })

    expect(doc.methods.map(method => 'paramStructure' in method && method.paramStructure)).toEqual(['by-name', 'by-name', 'by-name', 'by-name'])
  })

  it.each([
    ['a primitive', z.number(), { type: 'number' }],
    ['a record', z.record(z.string(), z.number()), { type: 'object', additionalProperties: { type: 'number' } }],
    ['a union of objects', z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]), { anyOf: [expect.any(Object), expect.any(Object)] }],
    ['an object with an additionalProperties schema', z.object({ a: z.string() }).catchall(z.number()), { type: 'object', additionalProperties: { type: 'number' } }],
    ['an object with an empty property name', z.object({ '': z.string() }), { type: 'object', required: [''] }],
  ])('describes %s input as a single by-position param', async (_, schema, expected) => {
    const doc = await generator.generate({ ping: oc.input(schema) })

    expect(doc.methods[0]).toMatchObject({
      paramStructure: 'by-position',
      params: [{ name: 'input', required: true, schema: expected }],
    })
  })

  it('has no params without input or when the input is unconstrained and optional', async () => {
    const doc = await generator.generate({
      none: oc,
      void: oc.input(z.void()),
      any: oc.input(z.any()),
      required: oc.input(z.any().nonoptional()),
    })

    expect(doc.methods.slice(0, 3)).toEqual([
      { name: 'none', params: [], result: { name: 'result', schema: {} } },
      { name: 'void', params: [], result: { name: 'result', schema: {} } },
      { name: 'any', params: [], result: { name: 'result', schema: {} } },
    ])
    expect(doc.methods[3]).toMatchObject({ paramStructure: 'by-position', params: [{ name: 'input', required: true, schema: {} }] })
  })

  it('merges multiple input and output schemas with allOf', async () => {
    const doc = await generator.generate({
      planet: oc
        .input(z.object({ name: z.string() }))
        .input(z.object({ note: z.string() }).optional())
        .input(z.any())
        .output(z.object({ id: z.string() }))
        .output(z.object({ slug: z.string() })),
    })

    expect(doc.methods[0]).toMatchObject({
      paramStructure: 'by-position',
      params: [{ name: 'input', required: true, schema: { allOf: [{ required: ['name'] }, { required: ['note'] }] } }],
      result: { schema: { allOf: [{ required: ['id'] }, { required: ['slug'] }] } },
    })
  })

  it('keeps merged params optional when every input schema is optional', async () => {
    const doc = await generator.generate({
      planet: oc.input(z.object({ name: z.string() }).optional()).input(z.object({ note: z.string() }).optional()),
    })

    expect(doc.methods[0]).not.toHaveProperty('params.0.required')
  })
})

describe('openRPCGenerator result', () => {
  const generator = new OpenRPCGenerator()

  it('describes the output schema as the result, allowing null when the output is optional', async () => {
    const doc = await generator.generate({
      find: oc.output(z.string()),
      maybe: oc.output(z.string().optional()),
    })

    expect(doc.methods[0]).toMatchObject({ result: { name: 'result', schema: { type: 'string' } } })
    expect(doc.methods[1]).toMatchObject({ result: { name: 'result', schema: { anyOf: [{ type: 'string' }, { type: 'null' }] } } })
  })

  it('describes an unconstrained output as an empty schema', async () => {
    const doc = await generator.generate({ none: oc, void: oc.output(z.void()), any: oc.output(z.any()) })

    expect(doc.methods.map(method => 'result' in method && method.result)).toEqual(Array.from({ length: 3 }, () => ({ name: 'result', schema: {} })))
  })
})

describe('openRPCGenerator errors', () => {
  const generator = new OpenRPCGenerator()

  it('describes errors with their JSON-RPC code, message and oRPC code', async () => {
    const doc = await generator.generate({
      find: oc.errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) }, UNAUTHORIZED: {} }),
    })

    expect(doc.methods[0]).toMatchObject({
      errors: [
        { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true } },
        { code: -32001, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } },
      ],
    })
  })

  it('groups errors mapped to the same JSON-RPC code', async () => {
    const doc = await generator.generate({
      find: oc.errors({ BAD_GATEWAY: {}, SERVICE_UNAVAILABLE: { message: 'Try later' } }),
    })

    expect(doc.methods[0]).toMatchObject({
      errors: [{ code: -32603, message: 'Bad Gateway (BAD_GATEWAY) or Try later (SERVICE_UNAVAILABLE)' }],
    })
    expect(doc.methods[0]).not.toHaveProperty('errors.0.data')
  })

  it('uses the errorCodeMap, falling back to -32000 for missing codes', async () => {
    const doc = await generator.generate({
      buy: oc.errors({ OUT_OF_STOCK: {}, NOT_FOUND: {} }),
    }, { errorCodeMap: { OUT_OF_STOCK: 1001 } })

    expect(doc.methods[0]).toMatchObject({
      errors: [
        { code: 1001, message: 'Out Of Stock', data: { code: 'OUT_OF_STOCK', defined: true } },
        { code: -32000, message: 'Not Found', data: { code: 'NOT_FOUND', defined: true } },
      ],
    })
  })
})

describe('openRPCGenerator components', () => {
  const generator = new OpenRPCGenerator()

  it('hoists reusable schemas into components.schemas', async () => {
    const doc = await generator.generate({
      list: oc.output(z.array(planet)),
      find: oc.output(planet),
    })

    expect(doc.methods[0]).toMatchObject({ result: { schema: { type: 'array', items: { $ref: '#/components/schemas/Planet' } } } })
    expect(doc.methods[1]).toMatchObject({ result: { schema: { $ref: '#/components/schemas/Planet' } } })
    expect(doc.components).toEqual({
      schemas: {
        Planet: {
          type: 'object',
          properties: { id: { type: 'number' }, name: { type: 'string' } },
          required: ['id', 'name'],
          additionalProperties: false,
        },
      },
    })
  })

  it('gives components valid names', async () => {
    const doc = await generator.generate({ find: oc.output(z.string().meta({ id: 'Solar System/Planet' })) })

    expect(doc.methods[0]).toMatchObject({ result: { schema: { $ref: '#/components/schemas/Solar_System_Planet' } } })
    expect(doc.components).toEqual({ schemas: { Solar_System_Planet: { type: 'string' } } })
  })

  it('splits components that differ between input and output', async () => {
    const page = z.object({ size: z.number().default(10) }).meta({ id: 'Page' })

    const doc = await generator.generate({ list: oc.input(z.object({ page })).output(page) })

    expect(doc.methods[0]).toMatchObject({
      params: [{ name: 'page', schema: { $ref: '#/components/schemas/PageInput' } }],
      result: { schema: { $ref: '#/components/schemas/Page' } },
    })
    expect(doc.components?.schemas).toEqual({
      Page: expect.objectContaining({ required: ['size'] }),
      PageInput: expect.not.objectContaining({ required: expect.anything() }),
    })
  })
})

describe('openRPCGenerator meta', () => {
  const generator = new OpenRPCGenerator()

  it('applies openrpc meta: summary, description, deprecated, tags, externalDocs', async () => {
    const doc = await generator.generate({
      find: oc.meta(openrpc({
        summary: 'Find a planet',
        description: 'Returns a single planet.',
        deprecated: true,
        tags: ['planets'],
        externalDocs: { url: 'https://example.com/planets' },
      })),
    })

    expect(doc.methods[0]).toEqual({
      name: 'find',
      summary: 'Find a planet',
      description: 'Returns a single planet.',
      deprecated: true,
      tags: [{ name: 'planets' }],
      externalDocs: { url: 'https://example.com/planets' },
      params: [],
      result: { name: 'result', schema: {} },
    })
  })

  it('falls back to openapi meta for fields openrpc meta leaves undefined', async () => {
    const doc = await generator.generate({
      find: oc
        .meta(openapi({ summary: 'OpenAPI summary', description: 'OpenAPI description', deprecated: true, tags: ['openapi'] }))
        .meta(openrpc({ summary: 'OpenRPC summary', tags: ['openrpc'] })),
    })

    expect(doc.methods[0]).toMatchObject({
      summary: 'OpenRPC summary',
      description: 'OpenAPI description',
      deprecated: true,
      tags: [{ name: 'openrpc' }],
    })
  })

  it('replaces the whole method with an openrpc spec object, bypassing generation', async () => {
    const doc = await generator.generate({
      // this procedure would normally throw: File schemas cannot be sent over JSON-RPC
      upload: oc.meta(openrpc({ spec: { 'name': 'upload', 'params': [], 'x-custom': true } })).input(z.file()),
    })

    expect(doc.methods).toEqual([{ 'name': 'upload', 'params': [], 'x-custom': true }])
  })

  it('extends the generated method with an openrpc spec function', async () => {
    const doc = await generator.generate({
      find: oc.meta(openrpc({ spec: method => ({ ...method, 'x-rate-limit': 100 }) })).input(z.number()),
    })

    expect(doc.methods[0]).toMatchObject({ 'name': 'find', 'paramStructure': 'by-position', 'x-rate-limit': 100 })
  })
})

describe('openRPCGenerator examples', () => {
  const generator = new OpenRPCGenerator()

  it('describes example inputs as by-name params, omitting undefined ones', async () => {
    const doc = await generator.generate({
      find: oc
        .meta(openrpc({ examples: [{ name: 'earth', summary: 'Earth', description: 'Our home', input: { id: 1, name: undefined }, output: 'Earth' }] }))
        .input(z.object({ id: z.number(), name: z.string().optional() })),
    })

    expect(doc.methods[0]).toMatchObject({
      examples: [{ name: 'earth', summary: 'Earth', description: 'Our home', params: [{ name: 'id', value: 1 }], result: { name: 'result', value: 'Earth' } }],
    })
  })

  it('describes example inputs as a by-position param, and an undefined output as null', async () => {
    const doc = await generator.generate({
      find: oc.meta(openrpc({ examples: [{ name: 'earth', input: 1, output: undefined }] })).input(z.number()),
    })

    expect(doc.methods[0]).toMatchObject({
      examples: [{ name: 'earth', params: [{ name: 'input', value: 1 }], result: { name: 'result', value: null } }],
    })
  })

  it('describes examples without input or output with no params and no result', async () => {
    const doc = await generator.generate({
      ping: oc.meta(openrpc({ examples: [{ name: 'empty' }] })),
    })

    expect(doc.methods[0]).toMatchObject({ examples: [{ name: 'empty', params: [] }] })
    expect(doc.methods[0]).not.toHaveProperty('examples.0.result')
  })
})
