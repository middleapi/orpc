import { type } from 'arktype'
import * as z from 'zod'

import { ArkTypeToJsonSchemaConverter } from './converter.ts'

describe('arkTypeToJsonSchemaConverter', () => {
  const converter = new ArkTypeToJsonSchemaConverter()

  describe('.condition', () => {
    it.each([
      ['arktype input schema', type({ name: 'string' }), 'input', true],
      ['arktype output schema', type('number'), 'output', true],
      ['non-arktype schema', z.string() as never, 'input', false],
      ['undefined schema', undefined, 'output', false],
    ] as const)('matches %s', (_, schema, direction, expected) => {
      expect(converter.condition(schema, direction)).toBe(expected)
    })
  })

  it('keeps converting when standard validation throws while checking optionality', () => {
    const schema = type('string')

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
      ['optional input schema', type('string | undefined'), 'input', { type: 'string' }, true],
      ['optional output schema', type('string | undefined'), 'output', { type: 'string' }, true],
      [
        'required input schema',
        type('string'),
        'input',
        {
          type: 'string',
        },
        false,
      ],
      [
        'required output schema',
        type('string'),
        'output',
        {
          type: 'string',
        },
        false,
      ],
    ] as const)('marks %s correctly', (_, schema, direction, jsonSchema, optional) => {
      expect(converter.convert(schema, direction)).toEqual([jsonSchema, optional])
    })
  })

  describe('direction', () => {
    it.each([
      [
        'morph and default object',
        type({ a: 'string.numeric.parse', b: 'number = 5' }),
        {
          type: 'object',
          properties: {
            a: { type: 'string', pattern: expect.any(String) },
            b: { type: 'number', default: 5 },
          },
          required: ['a'],
        },
        {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
      ],
      [
        'pipe with output type',
        type('string')
          .pipe((s) => s.length)
          .to('number'),
        { type: 'string' },
        { type: 'number' },
      ],
      ['unconstrained pipe', type('string').pipe((s) => s.length), { type: 'string' }, {}],
    ] as const)('converts %s from the matching side', (_, schema, input, output) => {
      expect(converter.convert(schema, 'input')).toEqual([input, false])
      expect(converter.convert(schema, 'output')).toEqual([output, false])
    })
  })

  describe('undefined', () => {
    it.each([
      ['string | undefined', type('string | undefined'), { type: 'string' }],
      [
        'number | null | undefined',
        type('number | null | undefined'),
        { anyOf: [{ type: 'number' }, { type: 'null' }] },
      ],
      [
        "'a' | 'b' | undefined",
        type("'a' | 'b' | undefined"),
        { anyOf: [{ const: 'a' }, { const: 'b' }] },
      ],
      ['undefined', type('undefined'), { not: {} }],
    ] as const)('drops the undefined branch of %s', (_, schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, true])
      expect(converter.convert(schema, 'output')).toEqual([jsonSchema, true])
    })

    it('treats properties accepting undefined as optional', () => {
      const schema = type({
        'a': 'string | undefined',
        'b?': 'number | null | undefined',
        'c': 'undefined',
        'd': 'string',
      })

      expect(converter.convert(schema, 'input')).toEqual([
        {
          type: 'object',
          properties: {
            a: { type: 'string' },
            b: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            c: { not: {} },
            d: { type: 'string' },
          },
          required: ['d'],
        },
        false,
      ])

      expect(converter.convert(type({ a: 'string | undefined' }), 'input')).toEqual([
        { type: 'object', properties: { a: { type: 'string' } } },
        false,
      ])
    })

    it('treats properties referencing an undefined-accepting definition as optional', () => {
      const schema = type({ 'a': 'string | undefined', 'self?': 'this' })

      const [jsonSchema] = converter.convert(schema, 'input') as [any, boolean]
      const root = jsonSchema.$defs[jsonSchema.$ref.slice('#/$defs/'.length)]
      const a = jsonSchema.$defs[root.properties.a.$ref.slice('#/$defs/'.length)]

      expect(root.required).toBeUndefined()
      expect(a).toEqual({ type: 'string' })
    })

    it('drops undefined from array items', () => {
      expect(converter.convert(type('(string | undefined)[]'), 'input')).toEqual([
        { type: 'array', items: { type: 'string' } },
        false,
      ])
    })

    it('keeps the result of a custom fallback for undefined', () => {
      const converter = new ArkTypeToJsonSchemaConverter({
        fallback: (ctx) => (ctx.code === 'unit' ? { type: 'null' } : ctx.base),
      })

      expect(converter.convert(type({ a: 'string | undefined' }), 'input')).toEqual([
        {
          type: 'object',
          properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          required: ['a'],
        },
        false,
      ])
    })
  })

  describe('non-finite numbers', () => {
    it.each([
      ['number.Infinity', type('number.Infinity'), { not: {} }],
      ['number.NegativeInfinity', type('number.NegativeInfinity'), { not: {} }],
      ['number.NaN', type('number.NaN'), { not: {} }],
      ['number.Infinity | string', type('number.Infinity | string'), { type: 'string' }],
      ['1 | number.Infinity', type('1 | number.Infinity'), { enum: [1] }],
      ['1 | number.NaN', type('1 | number.NaN'), { const: 1 }],
      [
        'number.Infinity | number.NegativeInfinity',
        type('number.Infinity | number.NegativeInfinity'),
        { not: {} },
      ],
      [
        'object property',
        type({ a: 'number.Infinity' }),
        { type: 'object', properties: { a: { not: {} } }, required: ['a'] },
      ],
    ] as const)('converts %s without non-JSON values', (_, schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, false])
      expect(converter.convert(schema, 'output')).toEqual([jsonSchema, false])
    })

    it('passes non-finite units through custom fallbacks', () => {
      const units: unknown[] = []
      const converter = new ArkTypeToJsonSchemaConverter({
        fallback: {
          unit: (ctx) => {
            units.push(ctx.unit)
            return { type: 'number', description: String(ctx.unit as unknown as number) }
          },
        },
      })

      expect(converter.convert(type('number.Infinity'), 'input')).toEqual([
        { type: 'number', description: 'Infinity' },
        false,
      ])
      expect(converter.convert(type('1 | number.NegativeInfinity'), 'input')).toEqual([
        { anyOf: [{ enum: [1] }, { type: 'number', description: '-Infinity' }] },
        false,
      ])
      expect(converter.convert(type('number.NaN'), 'input')).toEqual([
        { type: 'number', description: 'NaN' },
        false,
      ])
      expect(units).toEqual([Infinity, -Infinity, Number.NaN])
    })

    it('passes the built-in never schema to a custom default fallback', () => {
      const converter = new ArkTypeToJsonSchemaConverter({
        fallback: (ctx) => ({ ...ctx.base, title: '__EXTENDED__' }),
      })

      expect(converter.convert(type('number.Infinity'), 'input')).toEqual([
        { not: {}, title: '__EXTENDED__' },
        false,
      ])
      expect(converter.convert(type('number.NaN'), 'input')).toEqual([
        { not: {}, title: '__EXTENDED__' },
        false,
      ])
    })
  })

  describe('tuple postfix elements', () => {
    it.each([
      [
        "['string', '...', 'number[]', 'boolean']",
        type(['string', '...', 'number[]', 'boolean']),
        {
          type: 'array',
          minItems: 2,
          prefixItems: [{ type: 'string' }],
          items: { anyOf: [{ type: 'number' }, { type: 'boolean' }] },
        },
      ],
      [
        "['...', 'number[]', 'boolean', 'null']",
        type(['...', 'number[]', 'boolean', 'null']),
        {
          type: 'array',
          minItems: 2,
          items: { anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
        },
      ],
      [
        "['...', 'number[]', 'number']",
        type(['...', 'number[]', 'number']),
        { type: 'array', minItems: 1, items: { type: 'number' } },
      ],
      [
        "['...', '(number | string)[]', 'string']",
        type(['...', '(number | string)[]', 'string']),
        { type: 'array', minItems: 1, items: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
      ],
    ] as const)('loosens items to accept postfix elements of %s', (_, schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, false])
      expect(converter.convert(schema, 'output')).toEqual([jsonSchema, false])
    })
  })

  describe('native type extensions', () => {
    it.each([
      [
        type('bigint'),
        {
          'type': 'string',
          'x-native-type': 'bigint',
          'pattern': '^-?[0-9]+$',
        },
      ],
      [
        type('Date'),
        {
          'type': 'string',
          'x-native-type': 'date',
          'format': 'date-time',
        },
      ],
    ] as const)('extends conversion for %s', (schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, false])
    })
  })

  it('passes built-in fallback mutations through custom handlers', () => {
    const functionConverter = new ArkTypeToJsonSchemaConverter({
      fallback: (ctx) => {
        return {
          ...ctx.base,
          title: '__EXTENDED__',
        }
      },
    })

    expect(functionConverter.convert(type('bigint'), 'input')).toEqual([
      {
        'pattern': '^-?[0-9]+$',
        'title': '__EXTENDED__',
        'type': 'string',
        'x-native-type': 'bigint',
      },
      false,
    ])

    const objectConverter = new ArkTypeToJsonSchemaConverter({
      fallback: {
        date: () => ({ type: 'string', title: '__DATE__' }),
        default: (ctx) => {
          return {
            ...ctx.base,
            title: '__EXTENDED__',
          }
        },
      },
    })

    expect(objectConverter.convert(type({ a: 'Date', b: 'bigint' }), 'input')).toEqual([
      {
        properties: {
          a: {
            title: '__DATE__',
            type: 'string',
          },
          b: {
            'pattern': '^-?[0-9]+$',
            'title': '__EXTENDED__',
            'type': 'string',
            'x-native-type': 'bigint',
          },
        },
        required: ['a', 'b'],
        type: 'object',
      },
      false,
    ])
  })

  describe('cache option', () => {
    it('reuses conversion results per schema and direction when enabled', () => {
      const converter = new ArkTypeToJsonSchemaConverter({ cache: true })
      const schema = type('string')
      // arktype interns types, so the same definition returns the same instance/spy across tests
      const toJsonSchema = vi.spyOn(schema, 'toJsonSchema')
      toJsonSchema.mockClear()

      const input = converter.convert(schema, 'input')
      expect(input).toEqual([{ type: 'string' }, false])
      expect(converter.convert(schema, 'input')).toBe(input)
      expect(toJsonSchema).toHaveBeenCalledTimes(1)

      const output = converter.convert(schema, 'output')
      expect(output).toEqual([{ type: 'string' }, false])
      expect(output).not.toBe(input)
      expect(converter.convert(schema, 'output')).toBe(output)
      expect(toJsonSchema).toHaveBeenCalledTimes(2)
    })

    it('converts on every call when disabled', () => {
      const schema = type('string')
      const toJsonSchema = vi.spyOn(schema, 'toJsonSchema')
      toJsonSchema.mockClear()

      const first = converter.convert(schema, 'input')
      const second = converter.convert(schema, 'input')

      expect(second).toEqual(first)
      expect(second).not.toBe(first)
      expect(toJsonSchema).toHaveBeenCalledTimes(2)
    })
  })
})
