import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter } from '@orpc/json-schema'
import type { OpenRPCGeneratorGenerateOptions } from './openrpc-generator'
import type { OpenRPCDocument, OpenRPCMethodObject } from './types'
import { validateOpenRPCDocument } from '@open-rpc/schema-utils-js'
import { eventIterator, oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { implement, os } from '@orpc/server'
import { clone, findDeepMatches } from '@orpc/shared'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { openrpc } from './meta'
import { OpenRPCGenerator, OpenRPCGeneratorError } from './openrpc-generator'

/**
 * A schema whose JSON Schema is given as is.
 */
function jsonSchema(schema: JsonSchema): AnySchema {
  return {
    '~standard': { version: 1, vendor: 'json-schema', validate: () => ({ issues: [{ message: 'no validation' }] }) },
    '~json-schema': schema,
  } as AnySchema
}

const jsonSchemaConverter: JsonSchemaConverter = {
  condition: schema => schema?.['~standard'].vendor === 'json-schema',
  convert: schema => [(schema as any)['~json-schema'], false],
}

const Planet = z.object({
  id: z.number().int(),
  name: z.string().describe('The planet name'),
  position: z.tuple([z.number(), z.number()]).optional(),
  discoveredAt: z.date().optional(),
}).meta({ id: 'Planet' })

const contract = {
  ping: oc.output(z.literal('pong')),
  planet: {
    find: oc
      .meta(openapi({ summary: 'Find a planet', tags: ['planets'] }))
      .meta(openrpc({ examples: [{ name: 'earth', input: { id: 1 }, output: { id: 1, name: 'Earth' } }] }))
      .errors({ NOT_FOUND: { message: 'Planet not found' }, UNAUTHORIZED: {} })
      .input(z.object({ id: z.number().int(), include: z.array(z.enum(['moons', 'rings'])).optional() }))
      .output(Planet),
    list: oc
      .input(z.object({ limit: z.number().int().max(100).optional(), cursor: z.string().optional() }).optional())
      .output(z.array(Planet)),
    rename: oc
      .input(z.tuple([z.number(), z.string()]))
      .output(Planet.optional()),
    remove: oc
      .meta(openrpc({ deprecated: true, description: 'Removes a planet' }))
      .input(z.number())
      .output(z.void()),
    watch: oc.output(eventIterator(Planet)),
  },
}

describe('openRPCGenerator', () => {
  const generator = new OpenRPCGenerator({ converters: [new ZodToJsonSchemaConverter()] })

  describe('document', () => {
    it('starts from the default document', async () => {
      await expect(generator.generate({})).resolves.toEqual({
        openrpc: '1.3.2',
        info: { title: 'API Reference', version: '0.0.0' },
        methods: [],
      })
    })

    it('uses the requested version', async () => {
      await expect(generator.generate({}, { version: '1.4.1' })).resolves.toMatchObject({ openrpc: '1.4.1' })
    })

    it('starts from base, keeping base methods first and base schemas as they are', async () => {
      const base: OpenRPCGeneratorGenerateOptions['base'] = {
        'info': { title: 'Planets', version: '1.0.0', description: 'Planet API' },
        'servers': [{ name: 'production', url: 'https://example.com/rpc' }],
        'externalDocs': { url: 'https://example.com/docs' },
        'methods': [
          { name: 'legacy.ping', params: [], result: { name: 'result', schema: { type: 'string' } } },
          { $ref: '#/components/methods/shared' },
        ],
        'components': {
          schemas: {
            Legacy: { type: 'array', prefixItems: [{ type: 'string' }], $schema: 'kept' } as JsonSchema,
          },
        },
        'x-custom': { kept: true },
      }
      const original = clone(base)

      const doc = await generator.generate({
        new: oc.input(z.object({ legacy: z.tuple([z.string()]) })),
      }, { base })

      expect(base).toEqual(original)
      expect(doc).toEqual({
        'openrpc': '1.3.2',
        'info': { title: 'Planets', version: '1.0.0', description: 'Planet API' },
        'servers': [{ name: 'production', url: 'https://example.com/rpc' }],
        'externalDocs': { url: 'https://example.com/docs' },
        'components': {
          schemas: {
            Legacy: { type: 'array', prefixItems: [{ type: 'string' }], $schema: 'kept' },
          },
        },
        'x-custom': { kept: true },
        'methods': [
          { name: 'legacy.ping', params: [], result: { name: 'result', schema: { type: 'string' } } },
          { $ref: '#/components/methods/shared' },
          {
            name: 'new',
            paramStructure: 'by-name',
            params: [{
              name: 'legacy',
              required: true,
              schema: { type: 'array', items: [{ type: 'string' }], additionalItems: false, minItems: 1, maxItems: 1 },
            }],
            result: { name: 'result', schema: {} },
          },
        ],
      })
    })

    it('ignores an openrpc field in base', async () => {
      await expect(generator.generate({}, { base: { openrpc: '0.0.1' } as any, version: '1.3.0' }))
        .resolves
        .toMatchObject({ openrpc: '1.3.0' })
    })

    it('serializes the document with the given serializer', async () => {
      const serializer = { serializeJson: vi.fn((json: unknown) => ({ json: { serialized: json } })), deserializeJson: vi.fn() }
      const generator = new OpenRPCGenerator({ serializer })

      await expect(generator.generate({})).resolves.toEqual({
        serialized: { openrpc: '1.3.2', info: { title: 'API Reference', version: '0.0.0' }, methods: [] },
      })
    })

    it('serializes values such as BigInt defaults and examples', async () => {
      const doc = await new OpenRPCGenerator({ converters: [jsonSchemaConverter] }).generate({
        count: oc
          .input(jsonSchema({ type: 'object', properties: { n: { type: 'integer', default: 10n } } }))
          .meta(openrpc({ examples: [{ name: 'count', input: { n: 2n }, output: new Set([1n]) }] })),
      })

      expect(doc.methods[0]).toEqual({
        name: 'count',
        paramStructure: 'by-name',
        params: [{ name: 'n', schema: { type: 'integer', default: '10' } }],
        result: { name: 'result', schema: {} },
        examples: [{ name: 'count', params: [{ name: 'n', value: '2' }], result: { name: 'result', value: ['1'] } }],
      })
    })

    it('rejects error code maps with non-integer codes', async () => {
      await expect(generator.generate({}, { errorCodeMap: { NOT_FOUND: 1.5 } })).rejects.toThrow(
        new TypeError('[OpenRPCGenerator] "errorCodeMap.NOT_FOUND" must be an integer JSON-RPC error code, received 1.5.'),
      )
    })
  })

  describe('methods', () => {
    it('describes every procedure in router order, skipping event iterators', async () => {
      const doc = await generator.generate(contract)

      expect(doc.methods.map(method => (method as OpenRPCMethodObject).name)).toEqual([
        'ping',
        'planet.find',
        'planet.list',
        'planet.rename',
        'planet.remove',
      ])

      expect(doc.methods).toEqual([
        {
          name: 'ping',
          params: [],
          result: { name: 'result', schema: { type: 'string', const: 'pong' } },
        },
        {
          name: 'planet.find',
          summary: 'Find a planet',
          tags: [{ name: 'planets' }],
          paramStructure: 'by-name',
          params: [
            { name: 'id', required: true, schema: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 } },
            { name: 'include', schema: { type: 'array', items: { type: 'string', enum: ['moons', 'rings'] } } },
          ],
          result: { name: 'result', schema: { $ref: '#/components/schemas/Planet' } },
          errors: [
            { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true } },
            { code: -32001, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } },
          ],
          examples: [{
            name: 'earth',
            params: [{ name: 'id', value: 1 }],
            result: { name: 'result', value: { id: 1, name: 'Earth' } },
          }],
        },
        {
          name: 'planet.list',
          paramStructure: 'by-name',
          params: [
            { name: 'limit', schema: { type: 'integer', minimum: -9007199254740991, maximum: 100 } },
            { name: 'cursor', schema: { type: 'string' } },
          ],
          result: { name: 'result', schema: { type: 'array', items: { $ref: '#/components/schemas/Planet' } } },
        },
        {
          name: 'planet.rename',
          paramStructure: 'by-position',
          params: [{
            name: 'input',
            required: true,
            schema: { type: 'array', items: [{ type: 'number' }, { type: 'string' }], additionalItems: false, minItems: 2, maxItems: 2 },
          }],
          result: { name: 'result', schema: { anyOf: [{ $ref: '#/components/schemas/Planet' }, { type: 'null' }] } },
        },
        {
          name: 'planet.remove',
          description: 'Removes a planet',
          deprecated: true,
          paramStructure: 'by-position',
          params: [{ name: 'input', required: true, schema: { type: 'number' } }],
          result: { name: 'result', schema: { type: 'null' } },
        },
      ])
    })

    it('hoists shared schemas into draft-07 components', async () => {
      const doc = await generator.generate(contract)

      expect(doc.components).toEqual({
        schemas: {
          Planet: {
            type: 'object',
            properties: {
              id: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
              name: { type: 'string', description: 'The planet name' },
              position: { type: 'array', items: [{ type: 'number' }, { type: 'number' }], additionalItems: false, minItems: 2, maxItems: 2 },
              discoveredAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
            },
            required: ['id', 'name'],
            additionalProperties: false,
          },
        },
      })
    })

    it('generates a document valid against the OpenRPC 1.3 and 1.4 meta-schemas', async () => {
      const Category: z.ZodType = z.lazy(() => z.object({
        name: z.string(),
        children: z.array(Category),
      }))

      const router = {
        ...contract,
        category: {
          create: oc
            .meta(openrpc({
              tags: ['categories'],
              externalDocs: { url: 'https://example.com/categories' },
              examples: [{ name: 'root', summary: 'Root category', input: { name: 'root', children: [] } }],
            }))
            .errors({ CONFLICT: {}, GONE: {}, BAD_GATEWAY: {}, SERVICE_UNAVAILABLE: {} })
            .input(z.object({ name: z.string(), children: z.array(Category), parent: Planet.describe('The parent planet').optional() }))
            .output(Category),
          stats: oc.input(z.record(z.string(), z.number())).output(z.map(z.string(), z.set(z.number()))),
          search: oc.input(z.union([z.string(), z.object({ query: z.string() })])).output(z.any()),
        },
      }

      const base = {
        info: { title: 'Planets', version: '1.0.0', license: { name: 'MIT' } },
        servers: [{ name: 'local', url: 'http://localhost:3000/rpc' }],
      }

      const doc13 = await generator.generate(router, { base })
      const doc14 = await generator.generate(router, { base, version: '1.4.1' })

      expect(doc13.openrpc).toBe('1.3.2')
      expect(doc14.openrpc).toBe('1.4.1')
      expect(validateOpenRPCDocument(doc13 as any)).toBe(true)
      expect(validateOpenRPCDocument(doc14 as any)).toBe(true)

      // draft 2020-12 leftovers draft-07 tools would misread
      expect(findDeepMatches(v => typeof v === 'object' && v !== null && ('$defs' in v || '$schema' in v || 'prefixItems' in v), doc13).values).toEqual([])
      expect(findDeepMatches(v => typeof v === 'string' && v.startsWith('#/$defs/'), doc13).values).toEqual([])
    })

    it('uses OpenAPI meta and generates lazy and contract-first routers', async () => {
      const findContract = oc
        .meta(openapi({ summary: 'Find a planet', description: 'Finds a planet', deprecated: true, tags: ['planets'] }))
        .input(z.object({ id: z.number() }))
        .output(z.object({ name: z.string() }))

      const router = implement({ planet: { find: findContract } }).router({
        planet: {
          find: implement(findContract).handler(() => ({ name: 'Earth' })),
        },
      })

      const lazyRouter = {
        planet: os.lazy(() => Promise.resolve({ default: { find: os.meta(openapi({ summary: 'Lazy find' })).handler(() => 'Earth') } })),
      }

      await expect(generator.generate(router)).resolves.toMatchObject({
        methods: [{
          name: 'planet.find',
          summary: 'Find a planet',
          description: 'Finds a planet',
          deprecated: true,
          tags: [{ name: 'planets' }],
          paramStructure: 'by-name',
          params: [{ name: 'id', required: true, schema: { type: 'number' } }],
        }],
      })

      await expect(generator.generate(lazyRouter)).resolves.toMatchObject({
        methods: [{ name: 'planet.find', summary: 'Lazy find', params: [] }],
      })
    })

    it('filters procedures', async () => {
      const filter = vi.fn((_procedure: unknown, path: readonly string[]) => path.at(-1) !== 'find')
      const doc = await generator.generate(contract, { filter })

      expect(doc.methods.map(method => (method as OpenRPCMethodObject).name)).toEqual(['ping', 'planet.list', 'planet.rename', 'planet.remove'])
      expect(filter).toHaveBeenCalledWith(contract.planet.find, ['planet', 'find'])
      expect(filter).toHaveBeenCalledWith(contract.planet.watch, ['planet', 'watch'])
    })

    it('skips procedures with event iterator inputs or outputs', async () => {
      const doc = await generator.generate({
        input: oc.input(eventIterator(z.string())),
        output: os.output(eventIterator(z.string())).handler(async function* () {}),
        both: oc.input(z.string()).output(z.string()),
      })

      expect(doc.methods).toEqual([expect.objectContaining({ name: 'both' })])
    })

    it('uses a custom error code map', async () => {
      const doc = await generator.generate({
        buy: oc.errors({ OUT_OF_STOCK: { message: 'Out of stock' }, NOT_FOUND: {} }),
      }, { errorCodeMap: { OUT_OF_STOCK: 1001 } })

      expect((doc.methods[0] as OpenRPCMethodObject).errors).toEqual([
        { code: 1001, message: 'Out of stock', data: { code: 'OUT_OF_STOCK', defined: true } },
        { code: -32000, message: 'Not Found', data: { code: 'NOT_FOUND', defined: true } },
      ])
    })

    it('lowers schemas of spec overrides, but keeps base methods as they are', async () => {
      const doc = await generator.generate({
        object: oc.meta(openrpc({
          spec: {
            name: 'object',
            params: [
              { name: 'tuple', schema: { prefixItems: [{ type: 'string' }] } },
              { $ref: '#/components/contentDescriptors/Shared' },
            ],
            result: { name: 'result', schema: { $ref: '#/components/schemas/A', description: 'A' } },
          },
        })),
        fn: oc.input(z.tuple([z.string()])).meta(openrpc({ spec: method => ({ ...method, result: { $ref: '#/components/contentDescriptors/Result' } }) })),
      }, {
        base: {
          methods: [{ name: 'base', params: [{ name: 'tuple', schema: { prefixItems: [{ type: 'string' }] } }] }],
        },
      })

      expect(doc.methods).toEqual([
        { name: 'base', params: [{ name: 'tuple', schema: { prefixItems: [{ type: 'string' }] } }] },
        {
          name: 'object',
          params: [
            { name: 'tuple', schema: { items: [{ type: 'string' }] } },
            { $ref: '#/components/contentDescriptors/Shared' },
          ],
          result: { name: 'result', schema: { allOf: [{ $ref: '#/components/schemas/A' }], description: 'A' } },
        },
        {
          name: 'fn',
          paramStructure: 'by-position',
          params: [{ name: 'input', required: true, schema: { type: 'array', items: [{ type: 'string' }], additionalItems: false, minItems: 1, maxItems: 1 } }],
          result: { $ref: '#/components/contentDescriptors/Result' },
        },
      ])
    })
  })

  describe('components', () => {
    it('sanitizes component names and applies customComponentName', async () => {
      const A = z.object({ a: z.string() }).meta({ id: 'a b/c' })
      const B = z.object({ b: z.string() }).meta({ id: 'B' })
      const customComponentName = vi.fn((defName: string) => defName === 'B' ? 'Custom<B>' : undefined)

      const doc = await generator.generate({
        a: oc.input(z.object({ a: A, b: B })),
      }, { customComponentName })

      expect(Object.keys(doc.components?.schemas ?? {})).toEqual(['a_b_c', 'Custom_B_'])
      expect((doc.methods[0] as OpenRPCMethodObject).params).toEqual([
        { name: 'a', required: true, schema: { $ref: '#/components/schemas/a_b_c' } },
        { name: 'b', required: true, schema: { $ref: '#/components/schemas/Custom_B_' } },
      ])
      expect(customComponentName).toHaveBeenCalledWith('a b/c', expect.objectContaining({ type: 'object' }))
    })

    it('postfixes conflicting names and reuses equivalent schemas', async () => {
      const doc = await generator.generate({
        a: oc.input(z.object({ p: z.object({ a: z.string() }).meta({ id: 'P' }) })).output(z.object({ a: z.string() }).meta({ id: 'P' })),
        b: oc.input(z.object({ p: z.object({ a: z.string() }).meta({ id: 'P' }) })).output(z.object({ b: z.number() }).meta({ id: 'P' })),
      })

      expect(Object.keys(doc.components?.schemas ?? {})).toEqual(['P', 'POutput', 'P2'])
    })

    it('hoists recursive schemas', async () => {
      const Category: z.ZodType = z.lazy(() => z.object({ name: z.string(), children: z.array(Category) }))

      const doc = await generator.generate({ category: oc.input(Category).output(Category) })

      expect(doc.methods[0]).toEqual({
        name: 'category',
        paramStructure: 'by-name',
        params: [
          { name: 'name', required: true, schema: { type: 'string' } },
          { name: 'children', required: true, schema: { type: 'array', items: { $ref: '#/components/schemas/__schema0' } } },
        ],
        result: { name: 'result', schema: { $ref: '#/components/schemas/__schema0Output' } },
      })
      expect(doc.components?.schemas).toEqual({
        __schema0: {
          type: 'object',
          properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/__schema0' } } },
          required: ['name', 'children'],
        },
        __schema0Output: {
          type: 'object',
          properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/__schema0Output' } } },
          required: ['name', 'children'],
          additionalProperties: false,
        },
      })
    })

    it('reuses an equivalent base component without lowering it', async () => {
      const doc = await generator.generate({
        a: oc.output(z.object({ tuple: z.tuple([z.string()]) }).meta({ id: 'Shared' })),
      }, {
        base: {
          components: {
            schemas: {
              Shared: {
                type: 'object',
                properties: { tuple: { type: 'array', prefixItems: [{ type: 'string' }], items: false, minItems: 1, maxItems: 1 } },
                required: ['tuple'],
                additionalProperties: false,
              },
            },
          },
        },
      })

      expect((doc.methods[0] as OpenRPCMethodObject).result).toEqual({ name: 'result', schema: { $ref: '#/components/schemas/Shared' } })
      expect(Object.keys(doc.components?.schemas ?? {})).toEqual(['Shared'])
      expect(doc.components?.schemas?.Shared).toHaveProperty('properties.tuple.prefixItems')
    })
  })

  describe('errors', () => {
    it('collects every problem into one error', async () => {
      const router = {
        'upload': oc.input(z.object({ file: z.file() })),
        'download': oc.output(z.file()),
        'a.b': oc,
        'empty': { '': oc },
        'rpc': { discover: oc },
        'fine': oc,
        'example': oc.input(z.object({ a: z.string() })).meta(openrpc({ examples: [{ name: 'bad', input: 'x' }] })),
      }

      await expect(generator.generate(router, { base: { methods: [{ name: 'fine', params: [] }] } })).rejects.toThrow(new OpenRPCGeneratorError(
        '[OpenRPCGenerator] Failed to generate the OpenRPC document (7 errors):\n\n'
        + 'Procedure at upload: the input schema contains a File/Blob schema, which JSON-RPC cannot carry.\n\n'
        + 'Procedure at download: the output schema contains a File/Blob schema, which JSON-RPC cannot carry.\n\n'
        + 'Procedure at a.b: the router key "a.b" contains ".", so calls to the method "a.b" cannot reach this procedure.\n\n'
        + 'Procedure at empty.: the router key "" is empty, so calls to the method "empty." cannot reach this procedure.\n\n'
        + 'Procedure at rpc.discover: method names starting with "rpc." are reserved by JSON-RPC.\n\n'
        + 'Procedure at fine: duplicate method name "fine".\n\n'
        + 'Procedure at example: the input of example "bad" must be an object, since the method takes by-name params.\n\n'
        + 'Exclude procedures with the "filter" option (use the same filter on OpenRPCHandler).',
      ))
    })

    it('reports a root procedure', async () => {
      await expect(generator.generate(oc)).rejects.toThrow(
        '[OpenRPCGenerator] Failed to generate the OpenRPC document (1 error):\n\n'
        + 'Procedure at (root): the root procedure has no method name, nest it in a router.\n\n',
      )
    })

    it('reports duplicate names from spec overrides', async () => {
      await expect(generator.generate({
        a: oc.meta(openrpc({ spec: { name: 'same', params: [] } })),
        b: oc.meta(openrpc({ spec: { name: 'same', params: [] } })),
      })).rejects.toThrow('Procedure at b: duplicate method name "same".')
    })

    it('allows a top-level rpc procedure and filtered problems', async () => {
      const doc = await generator.generate({
        rpc: oc,
        upload: oc.input(z.object({ file: z.file() })),
      }, { filter: (_, path) => path[0] !== 'upload' })

      expect(doc.methods).toEqual([expect.objectContaining({ name: 'rpc' })])
    })

    it('rethrows unexpected errors', async () => {
      const error = new Error('converter failed')
      const generator = new OpenRPCGenerator({
        converters: [{ condition: () => true, convert: () => { throw error } }],
      })

      await expect(generator.generate({ a: oc.input(z.string()) })).rejects.toBe(error)
    })
  })

  it('returns a new document on every call', async () => {
    const doc1 = await generator.generate(contract)
    const doc2 = await generator.generate(contract)

    expect(doc1).toEqual(doc2)
    expect(doc1).not.toBe(doc2)
    expect(doc1.components).not.toBe(doc2.components)
  })

  it('keeps the document free of undefined values', async () => {
    const serializer = { serializeJson: (json: unknown) => ({ json }), deserializeJson: vi.fn() }
    const doc: OpenRPCDocument = await new OpenRPCGenerator({ serializer, converters: [new ZodToJsonSchemaConverter()] }).generate(contract)

    expect(findDeepMatches(v => v === undefined, doc).values).toEqual([])
  })
})
