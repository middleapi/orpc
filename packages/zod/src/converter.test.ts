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

  it('keeps converting when standard validation throws while checking optionality', () => {
    const schema = z.string()

    Object.defineProperty(schema, '~standard', {
      value: {
        ...schema['~standard'],
        validate: () => {
          throw new Error('validate failed')
        },
      },
    })
    expect(converter.convert(schema, 'input')).toEqual([{ type: 'string' }, false])
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

    it('avoids overwriting existing $defs when the root id collides', () => {
      const schema = z.string().meta({ id: 'root' })

      vi.mocked(toJSONSchema).mockReturnValueOnce({
        $defs: {
          root: {
            type: 'number',
          },
        },
        type: 'string',
      } as any)

      expect(converter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/root__0',
        $defs: {
          root: {
            type: 'number',
          },
          root__0: {
            type: 'string',
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

    it('prefers direction-specific registries over JSON_SCHEMA_REGISTRY', () => {
      const schema = z.codec(z.string(), z.number(), {
        decode: value => Number(value),
        encode: value => String(value),
      })

      JSON_SCHEMA_REGISTRY.add(schema, { description: 'general' })
      JSON_SCHEMA_INPUT_REGISTRY.add(schema, { examples: ['20'] })
      JSON_SCHEMA_OUTPUT_REGISTRY.add(schema, { examples: [20] })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'string',
        examples: ['20'],
      }, false])

      expect(converter.convert(schema, 'output')).toEqual([{
        type: 'number',
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
})
