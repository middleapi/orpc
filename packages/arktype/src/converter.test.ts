import { type } from 'arktype'
import * as z from 'zod'
import { ArkTypeToJsonSchemaConverter } from './converter'

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

  it('does not run standard validation to check optionality', () => {
    const schema = type('number | undefined')
    const validate = vi.fn(() => {
      throw new Error('validate failed')
    })

    Object.defineProperty(schema, '~standard', {
      value: {
        ...schema['~standard'],
        validate,
      },
    })

    expect(converter.convert(schema, 'input')).toEqual([{ anyOf: [{ type: 'number' }, {}] }, true])
    expect(converter.convert(schema, 'output')).toEqual([{ anyOf: [{ type: 'number' }, {}] }, true])
    expect(validate).not.toHaveBeenCalled()
  })

  it('does not leak rejections from async morphs', async ({ onTestFinished }) => {
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)
    onTestFinished(() => {
      process.off('unhandledRejection', unhandledRejection)
    })

    const morph = vi.fn(async () => {
      throw new Error('boom')
    })

    const schema = type('undefined').pipe(morph)
    expect(converter.convert(schema, 'input')).toEqual([{}, true])
    expect(converter.convert(schema, 'output')).toEqual([{}, false])

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(morph).not.toHaveBeenCalled()
    expect(unhandledRejection).not.toHaveBeenCalled()
  })

  describe('direction', () => {
    it('converts the output of morphs and defaults for the output direction', () => {
      const schema = type({ createdAt: 'string.date.iso.parse', tag: 'string = "x"' })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'object',
        properties: {
          createdAt: { type: 'string', pattern: expect.any(String) },
          tag: { type: 'string', default: 'x' },
        },
        required: ['createdAt'],
      }, false])

      expect(converter.convert(schema, 'output')).toEqual([{
        type: 'object',
        properties: {
          createdAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
          tag: { type: 'string' },
        },
        required: ['createdAt', 'tag'],
      }, false])
    })

    it('converts the declared output of a morph for the output direction', () => {
      const schema = type('string.numeric.parse')

      expect(converter.convert(schema, 'input')).toEqual([{ type: 'string', pattern: expect.any(String) }, false])
      expect(converter.convert(schema, 'output')).toEqual([{ type: 'number' }, false])
    })
  })

  describe('optionality', () => {
    it.each([
      ['optional input schema', type('string | undefined'), 'input', {
        anyOf: [
          { type: 'string' },
          {},
        ],
      }, true],
      ['optional output schema', type('string | undefined'), 'output', {
        anyOf: [
          {
            type: 'string',
          },
          {},
        ],
      }, true],
      ['required input schema', type('string'), 'input', {
        type: 'string',
      }, false],
      ['required output schema', type('string'), 'output', {
        type: 'string',
      }, false],
      ['unknown input schema', type('unknown'), 'input', {}, true],
      ['unknown output schema', type('unknown'), 'output', {}, true],
      ['morphed optional input schema', type('string | undefined').pipe(value => value ?? 'fallback'), 'input', {
        anyOf: [{ type: 'string' }, {}],
      }, true],
      ['morphed optional output schema', type('string | undefined').pipe(value => value ?? 'fallback'), 'output', {}, false],
      ['optional output schema with a morphed branch', type('string.numeric.parse | undefined'), 'output', {
        anyOf: [{ type: 'number' }, {}],
      }, true],
    ] as const)('marks %s correctly', (_, schema, direction, jsonSchema, optional) => {
      expect(converter.convert(schema, direction)).toEqual([jsonSchema, optional])
    })
  })

  describe('native type extensions', () => {
    it.each([
      [type('bigint'), {
        'type': 'string',
        'x-native-type': 'bigint',
        'pattern': '^-?[0-9]+$',
      }],
      [type('Date'), {
        'type': 'string',
        'x-native-type': 'date',
        'format': 'date-time',
      }],
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
