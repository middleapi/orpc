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

  it('reads optionality from zod metadata', () => {
    expect(converter.convert(z.string().optional(), 'input')).toEqual([expect.objectContaining({ type: 'string' }), true])
    expect(converter.convert(z.string().optional(), 'output')).toEqual([expect.objectContaining({ type: 'string' }), true])
    expect(converter.convert(z.string().nullable(), 'input')).toEqual([expect.anything(), false])
  })

  it('treats schemas from vendors without optionality metadata as required', () => {
    const schema = withStandardOverrides(z.string().optional(), { vendor: 'custom' })

    expect(converter.convert(schema, 'input')).toEqual([expect.objectContaining({ type: 'string' }), false])
    expect(converter.convert(schema, 'output')).toEqual([expect.objectContaining({ type: 'string' }), false])
  })

  it('does not run standard validation to check optionality', () => {
    const validate = vi.fn(() => {
      throw new Error('validate failed')
    })

    expect(converter.convert(withStandardOverrides(z.string().optional(), { validate }), 'input')).toEqual([
      expect.objectContaining({ type: 'string' }),
      true,
    ])

    expect(converter.convert(withStandardOverrides(arktype.type('string'), { validate }), 'output')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

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

    expect(converter.convert(z.string().refine(refine), 'input')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

    const optionalSchema = z.object({ email: z.string() }).optional().refine(refine)
    expect(converter.convert(optionalSchema, 'input')).toEqual([expect.objectContaining({ type: 'object' }), true])
    expect(converter.convert(optionalSchema, 'output')).toEqual([expect.objectContaining({ type: 'object' }), true])

    const rejectingSchema = withStandardOverrides(z.string(), {
      validate: () => Promise.reject(new Error('validate failed')),
    })
    expect(converter.convert(rejectingSchema, 'input')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(refine).not.toHaveBeenCalled()
    expect(unhandledRejection).not.toHaveBeenCalled()
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
