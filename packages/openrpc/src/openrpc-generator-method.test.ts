import type { AnySchema } from '@orpc/contract'
import type { JsonSchema } from '@orpc/json-schema'
import type { OpenRPCMethodContext } from './openrpc-generator-method'
import type { OpenRPCDocument } from './types'
import { oc } from '@orpc/contract'
import { DelegatingJsonSchemaConverter } from '@orpc/json-schema'
import { openapi, OpenAPIComponentRegistry, OpenAPIJsonSerializer } from '@orpc/openapi'
import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { openrpc } from './meta'
import {
  buildMethod,
  convertSchemas,
  OpenRPCGeneratorError,
  pruneUnreachableDefs,
  toByNameEntries,
  toOpenRPCComponentName,
} from './openrpc-generator-method'

/**
 * A schema whose JSON Schema is given as is, accepting `undefined` when `optional`.
 */
function jsonSchema(input: JsonSchema, { optional = false, output = input }: { optional?: boolean, output?: JsonSchema } = {}): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'json-schema',
      validate: (value: unknown) => value === undefined && optional ? { value } : { issues: [{ message: 'no validation' }] },
    },
    '~json-schema': { input, output, optional },
  } as AnySchema
}

const jsonSchemaConverter = {
  condition: (schema: AnySchema | undefined) => schema?.['~standard'].vendor === 'json-schema',
  convert: (schema: AnySchema | undefined, direction: 'input' | 'output'): [JsonSchema, boolean] => {
    const detail = (schema as any)['~json-schema']
    return [detail[direction], detail.optional]
  },
}

function createContext(overrides: Partial<OpenRPCMethodContext> = {}): { ctx: OpenRPCMethodContext, doc: OpenRPCDocument } {
  const doc: OpenRPCDocument = { openrpc: '1.3.2', info: { title: 'Test', version: '1.0.0' }, methods: [] }

  return {
    doc,
    ctx: {
      converter: new DelegatingJsonSchemaConverter([new ZodToJsonSchemaConverter(), jsonSchemaConverter]),
      registry: new OpenAPIComponentRegistry(doc, undefined),
      serializer: new OpenAPIJsonSerializer(),
      errorCodeMap: undefined,
      ...overrides,
    },
  }
}

describe('toByNameEntries', () => {
  it('splits a plain object', () => {
    expect(toByNameEntries({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    })).toEqual([
      ['a', { type: 'string' }, false],
      ['b', { type: 'number' }, true],
    ])
  })

  it.each([
    ['strict', z.strictObject({ a: z.string() })],
    ['loose', z.looseObject({ a: z.string() })],
    ['annotated', z.object({ a: z.string() }).meta({ 'title': 'Input', 'description': 'An input', 'examples': [{ a: 'x' }], 'x-custom': true })],
    ['root ref', z.object({ a: z.string() }).meta({ id: 'Input' })],
  ])('splits a %s object', (_, schema) => {
    const [jsonSchema] = new ZodToJsonSchemaConverter().convert(schema, 'input')

    expect(toByNameEntries(jsonSchema)?.map(([name, , optional]) => [name, optional])).toEqual([['a', false]])
  })

  it('splits objects with additionalProperties true or unconstrained, and objects without properties', () => {
    expect(toByNameEntries({ type: 'object', properties: { a: {} }, additionalProperties: true })).toHaveLength(1)
    expect(toByNameEntries({ type: 'object', properties: { a: {} }, additionalProperties: { description: 'any' } })).toHaveLength(1)
    expect(toByNameEntries({ type: 'object' })).toEqual([])
    expect(toByNameEntries({ type: 'object', properties: {} })).toEqual([])
  })

  it('keeps the root $defs reachable from the entries', () => {
    const entries = toByNameEntries({
      $ref: '#/$defs/Input',
      $defs: {
        Input: { type: 'object', properties: { planet: { $ref: '#/$defs/Planet' } }, required: ['planet'] },
        Planet: { type: 'object', properties: { name: { type: 'string' } } },
      },
    })

    expect(entries).toEqual([
      ['planet', { $ref: '#/$defs/Planet', $defs: expect.objectContaining({ Planet: expect.any(Object) }) }, false],
    ])
  })

  it.each([
    ['a non-object', { type: 'string' }],
    ['a boolean schema', true],
    ['an untyped object', { properties: { a: { type: 'string' } } }],
    ['a nullable object', { type: ['object', 'null'], properties: { a: { type: 'string' } } }],
    ['a union', { anyOf: [{ type: 'object', properties: { a: {} } }, { type: 'object', properties: { b: {} } }] }],
    ['an allOf', { type: 'object', allOf: [{ properties: { a: {} } }] }],
    ['a constrained additionalProperties', { type: 'object', properties: { a: {} }, additionalProperties: { type: 'number' } }],
    ['a record', { type: 'object', propertyNames: { type: 'string' }, additionalProperties: { type: 'number' } }],
    ['patternProperties', { type: 'object', properties: { a: {} }, patternProperties: { '^x': {} } }],
    ['minProperties', { type: 'object', properties: { a: {} }, minProperties: 1 }],
    ['an empty property name', { type: 'object', properties: { '': { type: 'string' } } }],
    ['a required name missing from properties', { type: 'object', properties: { a: {} }, required: ['a', 'b'] }],
    ['malformed required', { type: 'object', properties: { a: {} }, required: 'a' }],
    ['malformed properties', { type: 'object', properties: [{}] }],
    ['an unresolvable root ref', { $ref: '#/$defs/Missing', $defs: {} }],
  ])('keeps %s as a single param', (_, schema) => {
    expect(toByNameEntries(schema as JsonSchema)).toBeUndefined()
  })

  it('ignores undefined keywords', () => {
    expect(toByNameEntries({ type: 'object', properties: { a: {} }, patternProperties: undefined })).toHaveLength(1)
  })
})

describe('convertSchemas', () => {
  const converter = new DelegatingJsonSchemaConverter([jsonSchemaConverter])

  it('converts no schema to an optional unconstrained schema', () => {
    expect(convertSchemas(converter, undefined, 'input')).toEqual([{}, true])
    expect(convertSchemas(converter, [], 'output')).toEqual([{}, true])
  })

  it('strips $schema and hoists recursive refs', () => {
    expect(convertSchemas(converter, [jsonSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { self: { $ref: '#' } },
    })], 'input')).toEqual([{
      $ref: '#/$defs/__schema0',
      $defs: { __schema0: { type: 'object', properties: { self: { $ref: '#/$defs/__schema0' } } } },
    }, false])
  })

  it('keeps boolean schemas', () => {
    expect(convertSchemas(converter, [jsonSchema(false)], 'input')).toEqual([false, false])
  })

  it('combines several schemas with allOf of the constrained ones', () => {
    expect(convertSchemas(converter, [
      jsonSchema({ type: 'object' }, { optional: true }),
      jsonSchema({}, { optional: true }),
      jsonSchema({ required: ['a'] }),
    ], 'input')).toEqual([{ allOf: [{ type: 'object' }, { required: ['a'] }] }, false])

    expect(convertSchemas(converter, [jsonSchema({}, { optional: true }), jsonSchema({}, { optional: true })], 'output'))
      .toEqual([true, true])
  })

  it('uses the output direction', () => {
    expect(convertSchemas(converter, [jsonSchema({ type: 'string' }, { output: { type: 'number' } })], 'output'))
      .toEqual([{ type: 'number' }, false])
  })
})

describe('buildMethod', () => {
  describe('meta', () => {
    it('names the method after the path and reads OpenRPC meta', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.meta(openrpc({
        summary: 'Find a planet',
        description: 'Finds a planet by id',
        deprecated: true,
        tags: ['planets', 'read'],
        externalDocs: { url: 'https://example.com' },
      })), ['planet', 'find'])).toEqual({
        name: 'planet.find',
        summary: 'Find a planet',
        description: 'Finds a planet by id',
        tags: [{ name: 'planets' }, { name: 'read' }],
        externalDocs: { url: 'https://example.com' },
        deprecated: true,
        params: [],
        result: { name: 'result', schema: {} },
      })
    })

    it('falls back to OpenAPI meta field by field', () => {
      const { ctx } = createContext()
      const contract = oc
        .meta(openapi({ summary: 'OpenAPI summary', description: 'OpenAPI description', deprecated: true, tags: ['openapi'] }))
        .meta(openrpc({ summary: 'OpenRPC summary' }))

      expect(buildMethod(ctx, contract, ['a'])).toEqual({
        name: 'a',
        summary: 'OpenRPC summary',
        description: 'OpenAPI description',
        tags: [{ name: 'openapi' }],
        deprecated: true,
        params: [],
        result: { name: 'result', schema: {} },
      })

      expect(buildMethod(ctx, contract.meta(openrpc({ tags: ['openrpc'], deprecated: false })), ['a'])).toMatchObject({
        tags: [{ name: 'openrpc' }],
        deprecated: false,
      })
    })

    it('omits undefined fields', () => {
      const { ctx } = createContext()
      const method = buildMethod(ctx, oc.meta(openrpc({ summary: undefined })), ['a'])

      expect(Object.keys(method)).toEqual(['name', 'params', 'result'])
    })

    it('replaces the method with an object spec without converting any schema', () => {
      const { ctx } = createContext()
      const spec = { name: 'custom', params: [] }

      expect(buildMethod(ctx, oc.input(z.file()).meta(openrpc({ spec })), ['a'])).toBe(spec)
    })

    it('transforms the generated method with a function spec', () => {
      const { ctx } = createContext()
      const spec = vi.fn(method => ({ ...method, summary: 'from spec' }))

      expect(buildMethod(ctx, oc.input(z.object({ a: z.string() })).meta(openrpc({ summary: 'meta', spec })), ['a'])).toEqual({
        name: 'a',
        summary: 'from spec',
        paramStructure: 'by-name',
        params: [{ name: 'a', required: true, schema: { type: 'string' } }],
        result: { name: 'result', schema: {} },
      })
      expect(spec).toHaveBeenCalledWith(expect.objectContaining({ name: 'a', summary: 'meta' }))
    })

    it('works with server procedures', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, os.input(z.string()).output(z.number()).handler(() => 1), ['a'])).toEqual({
        name: 'a',
        paramStructure: 'by-position',
        params: [{ name: 'input', required: true, schema: { type: 'string' } }],
        result: { name: 'result', schema: { type: 'number' } },
      })
    })
  })

  describe('file schemas', () => {
    it.each([
      ['input', oc.input(z.object({ file: z.file() }))],
      ['input $defs', oc.input(jsonSchema({ $defs: { File: { type: 'string', contentMediaType: 'image/png' } } }))],
    ])('throws for a File/Blob %s', (_, contract) => {
      const { ctx } = createContext()

      expect(() => buildMethod(ctx, contract, ['a'])).toThrow(new OpenRPCGeneratorError(
        'the input schema contains a File/Blob schema, which JSON-RPC cannot carry.',
      ))
    })

    it('throws for a File/Blob output', () => {
      const { ctx } = createContext()

      expect(() => buildMethod(ctx, oc.output(z.array(z.file())), ['a'])).toThrow(new OpenRPCGeneratorError(
        'the output schema contains a File/Blob schema, which JSON-RPC cannot carry.',
      ))
    })
  })

  describe('params', () => {
    it.each([
      ['no input schema', oc],
      ['z.void()', oc.input(z.void())],
      ['z.undefined()', oc.input(z.undefined())],
      ['several void-like schemas', oc.input(z.void()).input(z.undefined())],
    ])('has no params for %s', (_, contract) => {
      const { ctx } = createContext()
      const method = buildMethod(ctx, contract, ['a'])

      expect(method.params).toEqual([])
      expect(method).not.toHaveProperty('paramStructure')
    })

    it('maps z.any() to an optional by-position input', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.any()), ['a'])).toMatchObject({
        paramStructure: 'by-position',
        params: [{ name: 'input', schema: {} }],
      })
    })

    it('maps a required object to by-name params, required ones first', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.object({
        limit: z.number().optional(),
        query: z.string(),
        cursor: z.string().optional(),
        sort: z.enum(['asc', 'desc']),
      })), ['a'])).toMatchObject({
        paramStructure: 'by-name',
        params: [
          { name: 'query', required: true, schema: { type: 'string' } },
          { name: 'sort', required: true, schema: { type: 'string', enum: ['asc', 'desc'] } },
          { name: 'limit', schema: { type: 'number' } },
          { name: 'cursor', schema: { type: 'string' } },
        ],
      })
    })

    it('maps an object without properties to no by-name params', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.object({})), ['a'])).toMatchObject({ paramStructure: 'by-name', params: [] })
      expect(buildMethod(ctx, oc.input(z.object({}).optional()), ['a'])).toMatchObject({ paramStructure: 'by-name', params: [] })
    })

    it('maps an optional object to by-name params when every property is optional', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.object({ limit: z.number().optional(), cursor: z.string().optional() }).optional()), ['a'])).toMatchObject({
        paramStructure: 'by-name',
        params: [
          { name: 'limit', schema: { type: 'number' } },
          { name: 'cursor', schema: { type: 'string' } },
        ],
      })

      expect(buildMethod(ctx, oc.input(z.object({ limit: z.number().optional() }).default({})), ['a'])).toMatchObject({
        paramStructure: 'by-name',
        params: [{ name: 'limit', schema: { type: 'number' } }],
      })
    })

    it('lifts description and deprecated into the content descriptor', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.object({
        id: z.number().describe('The planet id'),
        name: z.string().meta({ description: 'Old name', deprecated: true }).optional(),
      })), ['a']).params).toEqual([
        { name: 'id', description: 'The planet id', required: true, schema: { type: 'number', description: 'The planet id' } },
        { name: 'name', description: 'Old name', deprecated: true, schema: { type: 'string', description: 'Old name', deprecated: true } },
      ])
    })

    it.each([
      ['optional object', z.object({ a: z.string() }).optional(), false],
      ['nullable object', z.object({ a: z.string() }).nullable(), true],
      ['union', z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]), true],
      ['record', z.record(z.string(), z.number()), true],
      ['catchall object', z.object({ a: z.string() }).catchall(z.number()), true],
      ['string', z.string(), true],
      ['optional string', z.string().optional(), false],
      ['array', z.array(z.string()), true],
      ['tuple', z.tuple([z.string(), z.number()]), true],
    ])('maps a %s to a single by-position input', (_, schema, required) => {
      const { ctx } = createContext()
      const method = buildMethod(ctx, oc.input(schema), ['a'])

      expect(method.paramStructure).toBe('by-position')
      expect(method.params).toEqual([{
        name: 'input',
        ...(required && { required: true }),
        schema: new ZodToJsonSchemaConverter().convert(schema, 'input')[0],
      }])
    })

    it('lifts description and deprecated of a by-position input', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.string().meta({ description: 'A name', deprecated: true })), ['a']).params).toEqual([
        { name: 'input', description: 'A name', required: true, deprecated: true, schema: { type: 'string', description: 'A name', deprecated: true } },
      ])
    })

    it('hoists $defs into components, registering only the defs a param uses', () => {
      const { ctx, doc } = createContext()
      const Planet = z.object({ name: z.string() }).meta({ id: 'Planet' })
      const Input = z.object({ planet: Planet, id: z.number() }).meta({ id: 'FindPlanetInput' })

      expect(buildMethod(ctx, oc.input(Input), ['a']).params).toEqual([
        { name: 'planet', required: true, schema: { $ref: '#/components/schemas/Planet' } },
        { name: 'id', required: true, schema: { type: 'number' } },
      ])
      expect(doc.components?.schemas).toEqual({
        Planet: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      })
    })

    it('hoists the $defs of a by-position input', () => {
      const { ctx, doc } = createContext()
      const Planet = z.object({ name: z.string() }).meta({ id: 'Planet' })

      expect(buildMethod(ctx, oc.input(z.array(Planet)), ['a']).params).toEqual([
        { name: 'input', required: true, schema: { type: 'array', items: { $ref: '#/components/schemas/Planet' } } },
      ])
      expect(doc.components?.schemas).toHaveProperty('Planet')
    })
  })

  describe('result', () => {
    it.each([
      ['no output schema', oc, {}],
      ['z.any()', oc.output(z.any()), {}],
      ['z.void()', oc.output(z.void()), { type: 'null' }],
      ['z.undefined()', oc.output(z.undefined()), { type: 'null' }],
      ['z.string()', oc.output(z.string()), { type: 'string' }],
      ['z.string().optional()', oc.output(z.string().optional()), { anyOf: [{ type: 'string' }, { type: 'null' }] }],
      ['z.null()', oc.output(z.null()), { type: 'null' }],
    ])('describes %s', (_, contract, schema) => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, contract, ['a']).result).toEqual({ name: 'result', schema })
    })

    it('hoists $defs and allows null for an optional output', () => {
      const { ctx, doc } = createContext()
      const Planet = z.object({ name: z.string() }).meta({ id: 'Planet' })

      expect(buildMethod(ctx, oc.output(Planet.optional()), ['a']).result).toEqual({
        name: 'result',
        schema: { anyOf: [{ $ref: '#/components/schemas/Planet' }, { type: 'null' }] },
      })
      expect(doc.components?.schemas?.Planet).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      })
    })

    it('lifts the description and never marks the result required', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.output(z.string().meta({ description: 'The name', deprecated: true })), ['a']).result).toEqual({
        name: 'result',
        description: 'The name',
        schema: { type: 'string', description: 'The name', deprecated: true },
      })
    })
  })

  describe('errors', () => {
    it('describes defined errors with their default message and oRPC code', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.errors({
        NOT_FOUND: { message: 'Planet not found' },
        UNAUTHORIZED: {},
        OUT_OF_STOCK: { data: z.object({ left: z.number() }) },
        IGNORED: undefined,
      }), ['a']).errors).toEqual([
        { code: -32004, message: 'Planet not found', data: { code: 'NOT_FOUND', defined: true } },
        { code: -32001, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } },
        { code: -32000, message: 'Out Of Stock', data: { code: 'OUT_OF_STOCK', defined: true } },
      ])
    })

    it('groups errors mapped to the same code', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.errors({
        INTERNAL_SERVER_ERROR: {},
        UNAUTHORIZED: {},
        BAD_GATEWAY: { message: 'Upstream failed' },
        SERVICE_UNAVAILABLE: {},
      }), ['a']).errors).toEqual([
        { code: -32603, message: 'Internal Server Error (INTERNAL_SERVER_ERROR) or Upstream failed (BAD_GATEWAY) or Service Unavailable (SERVICE_UNAVAILABLE)' },
        { code: -32001, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } },
      ])
    })

    it('uses a custom error code map, which replaces the default', () => {
      const { ctx } = createContext({ errorCodeMap: { OUT_OF_STOCK: 1001, NOT_FOUND: 1002 } })

      expect(buildMethod(ctx, oc.errors({ OUT_OF_STOCK: {}, NOT_FOUND: {}, UNAUTHORIZED: {} }), ['a']).errors).toEqual([
        { code: 1001, message: 'Out Of Stock', data: { code: 'OUT_OF_STOCK', defined: true } },
        { code: 1002, message: 'Not Found', data: { code: 'NOT_FOUND', defined: true } },
        { code: -32000, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } },
      ])
    })

    it('omits errors when none are defined', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.errors({}), ['a'])).not.toHaveProperty('errors')
      expect(buildMethod(ctx, oc.errors({ NOT_FOUND: undefined }), ['a'])).not.toHaveProperty('errors')
    })
  })

  describe('examples', () => {
    it('maps by-name example inputs to one param per property', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc
        .input(z.object({ id: z.number(), at: z.date().optional(), note: z.string().optional() }))
        .output(z.object({ name: z.string() }))
        .meta(openrpc({
          examples: [
            { name: 'earth', summary: 'Earth', description: 'Finds Earth', input: { id: 1, at: new Date('2025-01-01T00:00:00.000Z'), note: undefined }, output: { name: 'Earth' } },
            { name: 'empty', input: undefined, output: undefined },
          ],
        })), ['a']).examples).toEqual([
        {
          name: 'earth',
          summary: 'Earth',
          description: 'Finds Earth',
          params: [{ name: 'id', value: 1 }, { name: 'at', value: '2025-01-01T00:00:00.000Z' }],
          result: { name: 'result', value: { name: 'Earth' } },
        },
        { name: 'empty', params: [], result: { name: 'result', value: null } },
      ])
    })

    it('throws for a non-object by-name example input', () => {
      const { ctx } = createContext()

      expect(() => buildMethod(ctx, oc.input(z.object({ id: z.number() })).meta(openrpc({ examples: [{ name: 'bad', input: [1] }] })), ['a']))
        .toThrow(new OpenRPCGeneratorError('the input of example "bad" must be an object, since the method takes by-name params.'))
    })

    it('maps by-position example inputs to a single input param', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.array(z.bigint())).meta(openrpc({
        examples: [
          { name: 'some', input: [1n, 2n], output: 3n },
          { name: 'none' },
        ],
      })), ['a']).examples).toEqual([
        { name: 'some', params: [{ name: 'input', value: ['1', '2'] }], result: { name: 'result', value: '3' } },
        { name: 'none', params: [] },
      ])
    })

    it('ignores example inputs of methods without params', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.void()).meta(openrpc({
        examples: [{ name: 'ping', input: 'ignored', output: 'pong' }],
      })), ['a']).examples).toEqual([
        { name: 'ping', params: [], result: { name: 'result', value: 'pong' } },
      ])
    })

    it('omits the result of notification examples', () => {
      const { ctx } = createContext()

      expect(buildMethod(ctx, oc.input(z.object({ event: z.string() })).meta(openrpc({
        examples: [{ name: 'notify', input: { event: 'ping' } }],
      })), ['a']).examples).toEqual([
        { name: 'notify', params: [{ name: 'event', value: 'ping' }] },
      ])
    })

    it('serializes with the given serializer', () => {
      const serializer = { serializeJson: vi.fn(() => ({ json: 'serialized' })), deserializeJson: vi.fn() }
      const { ctx } = createContext({ serializer })

      expect(buildMethod(ctx, oc.input(z.string()).meta(openrpc({ examples: [{ name: 'x', input: 'a', output: 'b' }] })), ['a']).examples)
        .toEqual([{ name: 'x', params: [{ name: 'input', value: 'serialized' }], result: { name: 'result', value: 'serialized' } }])
      expect(serializer.serializeJson).toHaveBeenCalledWith('a')
      expect(serializer.serializeJson).toHaveBeenCalledWith('b')
    })
  })
})

describe('toOpenRPCComponentName', () => {
  it.each([
    ['Planet', 'Planet'],
    ['planet.v1-final_2', 'planet.v1-final_2'],
    ['a b/c', 'a_b_c'],
    ['Planet<T>', 'Planet_T_'],
    ['é', '_'],
    ['', '_'],
  ])('sanitizes %j to %j', (name, sanitized) => {
    expect(toOpenRPCComponentName(name)).toBe(sanitized)
    expect(toOpenRPCComponentName(name)).toMatch(/^[\w.-]+$/)
  })
})

describe('pruneUnreachableDefs', () => {
  it('keeps schemas without $defs', () => {
    const schema: JsonSchema = { type: 'string' }

    expect(pruneUnreachableDefs(schema)).toBe(schema)
    expect(pruneUnreachableDefs(true)).toBe(true)
  })

  it('drops $defs the body cannot reach', () => {
    expect(pruneUnreachableDefs({
      type: 'array',
      items: { $ref: '#/$defs/A' },
      $defs: {
        'A': { properties: { b: { $ref: '#/$defs/B/properties/c' } } },
        'B': { properties: { c: { type: 'string' } } },
        'C/D': { type: 'number' },
        'Unused': { type: 'boolean' },
      },
    })).toEqual({
      type: 'array',
      items: { $ref: '#/$defs/A' },
      $defs: {
        A: { properties: { b: { $ref: '#/$defs/B/properties/c' } } },
        B: { properties: { c: { type: 'string' } } },
      },
    })
  })

  it('decodes JSON pointer segments and follows cycles', () => {
    expect(pruneUnreachableDefs({
      $ref: '#/$defs/C~1D',
      $defs: { 'C/D': { items: { $ref: '#/$defs/C~1D' } }, 'E': {} },
    })).toEqual({
      $ref: '#/$defs/C~1D',
      $defs: { 'C/D': { items: { $ref: '#/$defs/C~1D' } } },
    })
  })

  it('drops $defs entirely when none is reachable, and keeps the schema when all are', () => {
    expect(pruneUnreachableDefs({ type: 'string', $defs: { A: {} } })).toEqual({ type: 'string' })

    const schema = { $ref: '#/$defs/A', $defs: { A: {} } }

    expect(pruneUnreachableDefs(schema)).toBe(schema)
  })

  it('ignores refs to unknown defs and other documents', () => {
    expect(pruneUnreachableDefs({
      anyOf: [{ $ref: '#/$defs/Missing' }, { $ref: 'https://example.com/schema' }, { $ref: '#/components/schemas/A' }],
      $defs: { A: {} },
    })).toEqual({
      anyOf: [{ $ref: '#/$defs/Missing' }, { $ref: 'https://example.com/schema' }, { $ref: '#/components/schemas/A' }],
    })
  })
})
