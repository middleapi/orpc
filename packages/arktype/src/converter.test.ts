import { resolveJsonSchemaRootLocalRef } from '@orpc/json-schema'
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
      [
        'number | null | undefined',
        type('number | null | undefined'),
        { anyOf: [{ type: 'number' }, { type: 'null' }] },
      ],
      ['undefined', type('undefined'), {}],
    ] as const)('drops the undefined branch of %s', (_, schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, true])
      expect(converter.convert(schema, 'output')).toEqual([jsonSchema, true])
    })

    it('treats properties accepting undefined as optional only in output', () => {
      const schema = type({
        'a': 'string | undefined',
        'b?': 'number | null | undefined',
        'c': 'undefined',
        'd': 'string',
      })

      const properties = {
        a: { type: 'string' },
        b: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        c: {},
        d: { type: 'string' },
      }

      expect(converter.convert(schema, 'input')).toEqual([
        { type: 'object', properties, required: ['a', 'c', 'd'] },
        false,
      ])
      expect(converter.convert(schema, 'output')).toEqual([
        { type: 'object', properties, required: ['d'] },
        false,
      ])
    })

    it('treats output properties referencing an undefined-accepting definition as optional', () => {
      const schema = type({ 'a': 'string | undefined', 'self?': 'this' })

      const [jsonSchema] = converter.convert(schema, 'output') as [any, boolean]
      const root = resolveJsonSchemaRootLocalRef(jsonSchema) as any
      const a = resolveJsonSchemaRootLocalRef(root.properties.a, jsonSchema.$defs)

      expect(root.required).toBeUndefined()
      expect(a).toEqual({ type: 'string' })
    })

    it('keeps boolean schemas while dropping undefined', () => {
      expect(
        converter.convert(type({ '+': 'reject', 'a': 'string | undefined' }), 'output'),
      ).toEqual([
        { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
        false,
      ])

      const booleanConverter = new ArkTypeToJsonSchemaConverter({
        fallback: { proto: () => true as any },
      })

      expect(
        booleanConverter.convert(type({ a: ['Map', '|', 'undefined'], b: 'Map' }), 'output'),
      ).toEqual([{ type: 'object', properties: { a: true, b: true }, required: ['b'] }, false])
    })

    it('keeps undefined handling when the unit fallback is overridden per code', () => {
      const converter = new ArkTypeToJsonSchemaConverter({ fallback: { unit: (ctx) => ctx.base } })

      expect(converter.convert(type({ a: 'string | undefined' }), 'output')).toEqual([
        { type: 'object', properties: { a: { type: 'string' } } },
        false,
      ])
    })

    it('treats undefined wrapped by a custom fallback as undefined', () => {
      for (const fallback of [
        (ctx: any) => ({ allOf: [ctx.base] }),
        (ctx: any) => ({ anyOf: [ctx.base] }),
      ]) {
        const converter = new ArkTypeToJsonSchemaConverter({ fallback })

        expect(converter.convert(type({ a: 'string | undefined' }), 'output')).toEqual([
          { type: 'object', properties: { a: { type: 'string' } } },
          false,
        ])
      }

      const wrapping = new ArkTypeToJsonSchemaConverter({
        fallback: (ctx) => ({ allOf: [ctx.base] }),
      })

      expect(wrapping.convert(type('string | number.NaN'), 'input')).toEqual([
        { type: 'string' },
        false,
      ])
    })

    it('keeps schemas that only accept undefined unconstrained below the root', () => {
      expect(
        converter.convert(type({ 'body?': 'undefined', 'items': 'undefined[]' }), 'output'),
      ).toEqual([
        {
          type: 'object',
          properties: { body: {}, items: { type: 'array', items: {} } },
          required: ['items'],
        },
        false,
      ])
    })

    it('drops undefined from array items', () => {
      expect(converter.convert(type('(string | undefined)[]'), 'input')).toEqual([
        { type: 'array', items: { type: 'string' } },
        false,
      ])
    })

    it('still drops undefined when a custom fallback spreads the base schema', () => {
      const converter = new ArkTypeToJsonSchemaConverter({
        fallback: (ctx) => ({ ...ctx.base, title: '__EXTENDED__' }),
      })

      expect(converter.convert(type({ a: 'string | undefined' }), 'output')).toEqual([
        { type: 'object', properties: { a: { type: 'string' } } },
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

    it('leaves other unjsonifiable units to the fallback', () => {
      expect(converter.convert(type('1n'), 'input')).toEqual([{}, false])
    })

    it('drops never branches that carry annotations', () => {
      expect(
        converter.convert(type('number.Infinity').describe('inf').or('string'), 'input'),
      ).toEqual([{ type: 'string' }, false])
    })

    it('turns bounds past every number into never', () => {
      expect(converter.convert(type.number.atLeast(Infinity), 'input')).toEqual([
        { type: 'number', not: {} },
        false,
      ])
      expect(converter.convert(type.number.lessThan(-Infinity), 'input')).toEqual([
        { type: 'number', not: {} },
        false,
      ])
    })

    it('normalizes the siblings of a non-finite const', () => {
      const converter = new ArkTypeToJsonSchemaConverter({
        fallback: { unit: () => ({ description: 'fallback' }) },
      })

      expect(
        converter.convert(
          type('number.Infinity').configure({ description: 'user', examples: [Infinity] }),
          'input',
        ),
      ).toEqual([{ description: 'user', examples: [] }, false])
    })

    it('drops non-finite bounds and annotations', () => {
      expect(
        converter.convert(type('number <= 5').or(type.number.atMost(Infinity)), 'input'),
      ).toEqual([{ type: 'number' }, false])
      expect(converter.convert(type({ a: ['number', '=', Infinity] }), 'input')).toEqual([
        { type: 'object', properties: { a: { type: 'number' } } },
        false,
      ])
      expect(
        converter.convert(type('number').configure({ examples: [Infinity, 1] }), 'input'),
      ).toEqual([{ type: 'number', examples: [1] }, false])
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

    it('keeps boolean schemas returned by a custom unit fallback', () => {
      const rejecting = new ArkTypeToJsonSchemaConverter({ fallback: { unit: () => false as any } })
      const accepting = new ArkTypeToJsonSchemaConverter({ fallback: { unit: () => true as any } })

      expect(rejecting.convert(type({ a: 'number.Infinity' }), 'input')).toEqual([
        { type: 'object', properties: { a: { not: {} } }, required: ['a'] },
        false,
      ])
      expect(rejecting.convert(type('number.NaN | string'), 'input')).toEqual([
        { type: 'string' },
        false,
      ])
      expect(accepting.convert(type({ a: 'number.Infinity' }), 'input')).toEqual([
        { type: 'object', properties: { a: {} }, required: ['a'] },
        false,
      ])
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
      [type('File'), { type: 'string', contentMediaType: '*/*' }],
      [type('Blob'), { type: 'string', contentMediaType: '*/*' }],
    ] as const)('extends conversion for %s', (schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, false])
    })

    it('converts files nested in objects', () => {
      expect(converter.convert(type({ avatar: 'File', name: 'string' }), 'input')).toEqual([
        {
          type: 'object',
          properties: {
            avatar: { type: 'string', contentMediaType: '*/*' },
            name: { type: 'string' },
          },
          required: ['avatar', 'name'],
        },
        false,
      ])
    })

    it.each([
      ['instanceof types', type.instanceOf(Map)],
      ['domains', type('symbol')],
    ])('leaves other %s to the fallback option', (_, schema) => {
      expect(converter.convert(schema, 'input')).toEqual([{}, false])
    })
  })

  it('writes unjsonifiable defaults as JSON', () => {
    const [jsonSchema] = converter.convert(
      type({
        a: ['bigint', '=', 0n],
        c: ['symbol', '=', () => Symbol('c')],
      }),
      'input',
    ) as [any, boolean]

    expect(jsonSchema.properties.a.default).toBe('0')
    expect(jsonSchema.properties.c).not.toHaveProperty('default')
    expect(() => JSON.stringify(jsonSchema)).not.toThrow()
  })

  it('applies built-in handling before per-code custom handlers', () => {
    const converter = new ArkTypeToJsonSchemaConverter({
      fallback: { arrayPostfix: (ctx) => ctx.base, domain: (ctx) => ctx.base },
    })

    expect(converter.convert(type(['...', 'number[]', 'boolean']), 'input')).toEqual([
      { type: 'array', minItems: 1, items: { anyOf: [{ type: 'number' }, { type: 'boolean' }] } },
      false,
    ])
    expect(converter.convert(type('bigint'), 'input')).toEqual([
      { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' },
      false,
    ])
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
