import * as v from 'valibot'
import * as z from 'zod'
import { ZodToJsonSchemaConverter } from './converter'

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

  it('supports $ref & $defs at root level', () => {
    const schema = z.string().meta({ id: 'root' })

    expect(converter.convert(schema, 'input')).toEqual([{
      $ref: '#/$defs/root',
      $defs: {
        root: {
          type: 'string',
        },
      },
    }, false],
    )
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
})
