import type { AnySchema } from '@orpc/contract'
import * as arktype from 'arktype'
import z from 'zod'
import { StandardJsonSchemaConverter } from './standard-json-schema-converter'

function withStandardOverrides<TSchema extends AnySchema>(schema: TSchema, overrides: Record<string, unknown>): TSchema {
  Object.defineProperty(schema, '~standard', {
    value: {
      ...schema['~standard'],
      ...overrides,
    },
  })

  return schema
}

describe('standardJsonSchemaConverter', () => {
  const converter = new StandardJsonSchemaConverter()

  describe('.condition', () => {
    it.each([
      ['zod', z.string()],
      ['arktype', arktype.type('string')],
    ] as const)('accepts %s schemas', (_, schema) => {
      expect(converter.condition(schema, 'input')).toBe(true)
    })
  })

  it.each([
    ['zod', z.number().transform(String).pipe(z.string()), 'number', 'string'],
    ['arktype', arktype.type('number'), 'number', 'number'],
  ] as const)('uses %s standard json schema input and output generators', (_, schema, inputType, outputType) => {
    expect(converter.convert(schema, 'input')).toEqual([
      expect.objectContaining({ type: inputType }),
      false,
    ])

    expect(converter.convert(schema, 'output')).toEqual([
      expect.objectContaining({ type: outputType }),
      false,
    ])
  })

  it('infers optionality from zod and arktype', () => {
    expect(converter.convert(z.string().default('fallback'), 'input')).toEqual([
      expect.objectContaining({ type: 'string' }),
      true,
    ])

    expect(converter.convert(z.string().default('fallback'), 'output')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

    expect(converter.convert(arktype.type('string | undefined'), 'input')).toEqual([{}, true])

    expect(converter.convert(arktype.type('string | undefined'), 'output')).toEqual([{}, true])
  })

  it('keeps converting when standard validation is async or throws', () => {
    const asyncSchema = withStandardOverrides(z.string(), {
      validate: () => Promise.resolve({ value: undefined }),
    })

    expect(converter.convert(asyncSchema, 'output')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

    const throwingSchema = withStandardOverrides(arktype.type('string'), {
      validate: () => {
        throw new Error('validate failed')
      },
    })

    expect(converter.convert(throwingSchema, 'input')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])
  })

  it('falls back to an empty optional schema when json schema generation throws', () => {
    const schema = withStandardOverrides(z.string(), {
      jsonSchema: {
        input: () => {
          throw new Error('unsupported')
        },
        output: () => ({ type: 'string' }),
      },
    })

    expect(converter.convert(schema, 'input')).toEqual([{}, true])
  })
})
