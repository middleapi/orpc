import * as v from 'valibot'
import * as z from 'zod'
import { ValibotToJsonSchemaConverter } from './converter'

describe('valibotToJsonSchemaConverter', () => {
  const converter = new ValibotToJsonSchemaConverter()

  describe('.condition', () => {
    it.each([
      ['valibot input schema', v.string(), 'input', true],
      ['valibot output schema', v.optional(v.string()), 'output', true],
      ['non-valibot schema', z.string() as never, 'input', false],
      ['undefined schema', undefined, 'output', false],
    ] as const)('matches %s', (_, schema, direction, expected) => {
      expect(converter.condition(schema, direction)).toBe(expected)
    })
  })

  it.each([
    ['input', { type: 'number' }],
    ['output', { type: 'string' }],
  ] as const)('uses the requested %s direction when generating json schema', (direction, jsonSchema) => {
    expect(converter.convert(v.pipe(v.number(), v.transform(n => n.toString()), v.string()), direction)).toEqual([jsonSchema, false])
  })

  it('forwards extended toJsonSchema options from the constructor', () => {
    const converter = new ValibotToJsonSchemaConverter({
      overrideSchema: ({ jsonSchema }) => ({
        ...jsonSchema,
        description: 'root-schema',
      }),
    })

    expect(converter.convert(v.string(), 'input')).toEqual([
      {
        description: 'root-schema',
        type: 'string',
      },
      false,
    ])
  })

  it('keeps converting when standard validation throws while checking optionality', () => {
    const schema = v.string()

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

  describe('optionality', () => {
    it.each([
      ['defaulted input schema', v.optional(v.string(), 'fallback'), 'input', {
        default: 'fallback',
        type: 'string',
      }, true],
      ['defaulted output schema', v.optional(v.string(), 'fallback'), 'output', {
        default: 'fallback',
        type: 'string',
      }, false],
      ['undefined-producing output schema', v.optional(v.string()), 'output', {
        type: 'string',
      }, true],
      ['required input schema', v.string(), 'input', {
        type: 'string',
      }, false],
      ['required output schema', v.string(), 'output', {
        type: 'string',
      }, false],
    ] as const)('marks %s correctly', (_, schema, direction, jsonSchema, optional) => {
      expect(converter.convert(schema, direction)).toEqual([jsonSchema, optional])
    })
  })

  describe('native type extensions', () => {
    it.each([
      [v.bigint(), {
        'type': 'string',
        'x-native-type': 'bigint',
        'pattern': '^-?[0-9]+$',
      }],
      [v.date(), {
        'type': 'string',
        'x-native-type': 'date',
        'format': 'date-time',
      }],
      [v.set(v.string()), {
        'type': 'array',
        'x-native-type': 'set',
        'uniqueItems': true,
        'items': { type: 'string' },
      }],
      [v.map(v.string(), v.number()), {
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
