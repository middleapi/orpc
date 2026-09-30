import * as v from 'valibot'
import * as z from 'zod'
import { $ZodRegistry, toJSONSchema } from 'zod/v4/core'
import { ZodToJsonSchemaConverter } from './converter'
import { JSON_SCHEMA_INPUT_REGISTRY, JSON_SCHEMA_OUTPUT_REGISTRY, JSON_SCHEMA_REGISTRY } from './registries'

vi.mock('zod/v4/core', async (original) => {
  const mod = await original<typeof import('zod/v4/core')>()
  return {
    ...mod,
    toJSONSchema: vi.fn((...args: [any]) => mod.toJSONSchema(...args)),
  }
})

describe('zodToJsonSchemaConverter', () => {
  const converter = new ZodToJsonSchemaConverter()
  const codecSchema = z.codec(z.string(), z.number(), {
    decode: value => Number(value),
    encode: value => String(value),
  })

  describe('.condition', () => {
    it.each([
      ['zod input schema', z.string(), 'input', true],
      ['zod output schema', z.string().optional(), 'output', true],
      ['non-zod schema', v.string() as never, 'input', false],
      ['undefined schema', undefined, 'output', false],
    ] as const)('matches %s', (_, schema, direction, expected) => {
      expect(converter.condition(schema, direction)).toBe(expected)
    })
  })

  it.each([
    ['input', { type: 'string' }],
    ['output', { type: 'number' }],
  ] as const)('uses the requested %s direction when generating json schema', (direction, jsonSchema) => {
    expect(converter.convert(codecSchema, direction)).toEqual([jsonSchema, false])
  })

  it('forwards extended toJSONSchema options from the constructor', () => {
    const converter = new ZodToJsonSchemaConverter({
      override: ({ jsonSchema, path }) => {
        jsonSchema.description = path.length === 0 ? 'root-schema' : path.join('.')
      },
    })

    expect(converter.convert(codecSchema, 'input')).toEqual([
      {
        description: 'root-schema',
        type: 'string',
      },
      false,
    ])

    expect(converter.convert(codecSchema, 'output')).toEqual([
      {
        description: 'root-schema',
        type: 'number',
      },
      false,
    ])
  })

  it('does not run standard validation to check optionality', () => {
    const schema = z.string().optional()
    const validate = vi.fn(() => {
      throw new Error('validate failed')
    })

    Object.defineProperty(schema, '~standard', {
      value: {
        ...schema['~standard'],
        validate,
      },
    })

    expect(converter.convert(schema, 'input')).toEqual([{ type: 'string' }, true])
    expect(converter.convert(schema, 'output')).toEqual([{ type: 'string' }, true])
    expect(validate).not.toHaveBeenCalled()
  })

  it('does not leak rejections from async refinements', async ({ onTestFinished }) => {
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)
    onTestFinished(() => {
      process.off('unhandledRejection', unhandledRejection)
    })

    const refine = vi.fn(async () => {
      throw new Error('boom')
    })

    const schema = z.string().refine(refine)
    expect(converter.convert(schema, 'input')).toEqual([{ type: 'string' }, false])
    expect(converter.convert(schema, 'output')).toEqual([{ type: 'string' }, false])

    const optionalSchema = z.object({ email: z.string() }).optional().refine(refine)
    const optionalJsonSchema = { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }
    expect(converter.convert(optionalSchema, 'input')).toEqual([optionalJsonSchema, true])
    expect(converter.convert(optionalSchema, 'output')).toEqual([{ ...optionalJsonSchema, additionalProperties: false }, true])

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(refine).not.toHaveBeenCalled()
    expect(unhandledRejection).not.toHaveBeenCalled()
  })

  describe('supports $ref at root level', () => {
    it('with the global metadata registry and special json pointers', () => {
      const schema = z.object({
        a: z.string().meta({ id: 'a' }),
        b: z.number().meta({ id: 'b' }),
      }).meta({ id: 'root~/' })

      expect(converter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/root~0~1',
        $defs: {
          'a': {
            type: 'string',
          },
          'b': {
            type: 'number',
          },
          'root~/': {
            type: 'object',
            properties: {
              a: {
                $ref: '#/$defs/a',
              },
              b: {
                $ref: '#/$defs/b',
              },
            },
            required: [
              'a',
              'b',
            ],
          },
        },
      }, false],
      )
    })

    it('with a custom metadata registry', () => {
      const registry = new $ZodRegistry()
      const customConverter = new ZodToJsonSchemaConverter({ metadata: registry as any })

      const schema = z.object({
        a: z.string(),
      })

      registry.add(schema, { id: 'root' })
      registry.add(schema.shape.a, { id: 'a' })

      expect(customConverter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/root',
        $defs: {
          a: {
            type: 'string',
          },
          root: {
            type: 'object',
            properties: {
              a: {
                $ref: '#/$defs/a',
              },
            },
            required: [
              'a',
            ],
          },
        },
      }, false])
    })
  })

  describe('optionality', () => {
    it.each([
      ['defaulted input schema', z.string().default('fallback'), 'input', {
        default: 'fallback',
        type: 'string',
      }, true],
      ['defaulted output schema', z.string().default('fallback'), 'output', {
        default: 'fallback',
        type: 'string',
      }, false],
      ['undefined-producing output schema', z.string().optional(), 'output', {
        type: 'string',
      }, true],
      ['required input schema', z.string(), 'input', {
        type: 'string',
      }, false],
      ['required output schema', z.string(), 'output', {
        type: 'string',
      }, false],
      ['optional input schema', z.string().optional(), 'input', {
        type: 'string',
      }, true],
      ['prefaulted input schema', z.string().prefault('fallback'), 'input', {
        default: 'fallback',
        type: 'string',
      }, true],
      ['prefaulted output schema', z.string().prefault('fallback'), 'output', {
        type: 'string',
      }, false],
      ['nullable optional input schema', z.string().optional().nullable(), 'input', {
        type: ['string', 'null'],
      }, true],
      ['nullable optional output schema', z.string().optional().nullable(), 'output', {
        type: ['string', 'null'],
      }, true],
      ['union with an optional member input schema', z.union([z.string(), z.number().optional()]), 'input', {
        type: ['string', 'number'],
      }, true],
      ['defaulted output schema piped through a transform', z.string().optional().transform(value => value ?? 'fallback'), 'output', {}, false],
      ['optional input schema piped through a transform', z.string().optional().transform(value => value ?? 'fallback'), 'input', {
        type: 'string',
      }, true],
    ] as const)('marks %s correctly', (_, schema, direction, jsonSchema, optional) => {
      expect(converter.convert(schema, direction)).toEqual([jsonSchema, optional])
    })
  })

  describe('native type extensions', () => {
    it.each([
      [z.bigint(), {
        'type': 'string',
        'x-native-type': 'bigint',
        'pattern': '^-?[0-9]+$',
      }],
      [z.date(), {
        'type': 'string',
        'x-native-type': 'date',
        'format': 'date-time',
      }],
      [z.set(z.string()), {
        'type': 'array',
        'x-native-type': 'set',
        'uniqueItems': true,
        'items': { type: 'string' },
      }],
      [z.map(z.string(), z.number()), {
        'type': 'array',
        'x-native-type': 'map',
        'items': {
          type: 'array',
          prefixItems: [
            { type: 'string' },
            { type: 'number' },
          ],
          maxItems: 2,
          minItems: 2,
        },
      }],
    ] as const)('extends conversion for %s', (schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, false])
      expect(new ZodToJsonSchemaConverter({ unrepresentable: 'throw' }).convert(schema, 'input')).toEqual([jsonSchema, false])
    })

    it.each([
      ['set', (node: any) => z.set(node), { 'type': 'array', 'uniqueItems': true, 'items': { $ref: '#/$defs/__schema0' }, 'x-native-type': 'set' }],
      ['map', (node: any) => z.map(z.string(), node), {
        'type': 'array',
        'items': { type: 'array', prefixItems: [{ type: 'string' }, { $ref: '#/$defs/__schema0' }], maxItems: 2, minItems: 2 },
        'x-native-type': 'map',
      }],
    ] as const)('resolves recursion through %s into a $ref', (_, wrap, children) => {
      const Node: z.ZodType = z.object({
        get children() { return wrap(Node) },
      })

      expect(converter.convert(z.object({ tree: Node }), 'input')).toEqual([{
        type: 'object',
        properties: { tree: { $ref: '#/$defs/__schema0' } },
        required: ['tree'],
        $defs: {
          __schema0: {
            type: 'object',
            properties: { children },
            required: ['children'],
          },
        },
      }, false])

      expect(() => new ZodToJsonSchemaConverter({ cycles: 'throw' }).convert(Node, 'input')).toThrow('Cycle detected')
    })

    it('hoists set and map inner schemas with an id into the root $defs', () => {
      const schema = z.object({
        set: z.set(z.string().meta({ id: 'Item' })),
        map: z.map(z.string().meta({ id: 'Key' }), z.number().meta({ id: 'Value' })),
      })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'object',
        properties: {
          set: { 'type': 'array', 'uniqueItems': true, 'items': { $ref: '#/$defs/Item' }, 'x-native-type': 'set' },
          map: {
            'type': 'array',
            'items': { type: 'array', prefixItems: [{ $ref: '#/$defs/Key' }, { $ref: '#/$defs/Value' }], maxItems: 2, minItems: 2 },
            'x-native-type': 'map',
          },
        },
        required: ['set', 'map'],
        $defs: {
          Item: { type: 'string' },
          Key: { type: 'string' },
          Value: { type: 'number' },
        },
      }, false])
    })

    it('does not treat a schema reused inside a set or map as a cycle', () => {
      const tag = z.object({ name: z.string() })
      const tagJsonSchema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }

      expect(new ZodToJsonSchemaConverter({ cycles: 'throw' }).convert(z.object({
        tag,
        set: z.set(tag),
        map: z.map(tag, tag),
      }), 'input')).toEqual([{
        type: 'object',
        properties: {
          tag: tagJsonSchema,
          set: { 'type': 'array', 'uniqueItems': true, 'items': tagJsonSchema, 'x-native-type': 'set' },
          map: {
            'type': 'array',
            'items': { type: 'array', prefixItems: [tagJsonSchema, tagJsonSchema], maxItems: 2, minItems: 2 },
            'x-native-type': 'map',
          },
        },
        required: ['tag', 'set', 'map'],
      }, false])
    })

    it('leaves other unrepresentable types to the unrepresentable option', () => {
      const converter = new ZodToJsonSchemaConverter({ unrepresentable: ({ message }) => ({ description: message }) })

      expect(converter.convert(z.symbol(), 'input')).toEqual([{ description: 'Symbols cannot be represented in JSON Schema' }, false])
      expect(() => new ZodToJsonSchemaConverter({ unrepresentable: 'throw' }).convert(z.symbol(), 'input')).toThrow('Symbols cannot be represented')
    })
  })

  describe('custom json schema registries', () => {
    it('merges JSON_SCHEMA_REGISTRY entries over the generated schema for both directions', () => {
      const schema = z.string().min(3)
      JSON_SCHEMA_REGISTRY.add(schema, { examples: ['example'], minLength: 5 })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'string',
        minLength: 5,
        examples: ['example'],
      }, false])

      expect(converter.convert(schema, 'output')).toEqual([{
        type: 'string',
        minLength: 5,
        examples: ['example'],
      }, false])
    })

    it('shallow merges JSON_SCHEMA_REGISTRY with direction-specific registries, direction-specific keys win', () => {
      const schema = z.codec(z.string(), z.number(), {
        decode: value => Number(value),
        encode: value => String(value),
      })

      JSON_SCHEMA_REGISTRY.add(schema, { description: 'general', examples: ['general'] })
      JSON_SCHEMA_INPUT_REGISTRY.add(schema, { examples: ['20'] })
      JSON_SCHEMA_OUTPUT_REGISTRY.add(schema, { examples: [20] })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'string',
        description: 'general',
        examples: ['20'],
      }, false])

      expect(converter.convert(schema, 'output')).toEqual([{
        type: 'number',
        description: 'general',
        examples: [20],
      }, false])
    })

    it('applies to nested schemas', () => {
      const name = z.string()
      JSON_SCHEMA_REGISTRY.add(name, { description: 'name field' })

      const schema = z.object({ name })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'name field',
          },
        },
        required: ['name'],
      }, false])
    })
  })

  describe('cache option', () => {
    it('reuses conversion results per schema and direction when enabled', () => {
      const converter = new ZodToJsonSchemaConverter({ cache: true })

      vi.mocked(toJSONSchema).mockClear()

      const input = converter.convert(codecSchema, 'input')
      expect(input).toEqual([{ type: 'string' }, false])
      expect(converter.convert(codecSchema, 'input')).toBe(input)
      expect(toJSONSchema).toHaveBeenCalledTimes(1)

      const output = converter.convert(codecSchema, 'output')
      expect(output).toEqual([{ type: 'number' }, false])
      expect(output).not.toBe(input)
      expect(converter.convert(codecSchema, 'output')).toBe(output)
      expect(toJSONSchema).toHaveBeenCalledTimes(2)

      converter.convert(z.string(), 'input')
      expect(toJSONSchema).toHaveBeenCalledTimes(3)
    })

    it('converts on every call when disabled', () => {
      vi.mocked(toJSONSchema).mockClear()

      const first = converter.convert(codecSchema, 'input')
      const second = converter.convert(codecSchema, 'input')

      expect(second).toEqual(first)
      expect(second).not.toBe(first)
      expect(toJSONSchema).toHaveBeenCalledTimes(2)
    })
  })
})
