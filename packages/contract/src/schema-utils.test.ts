import * as arktype from 'arktype'
import * as v from 'valibot'
import z from 'zod'
import { isSchemaIssue, type, validateStackedInput } from './schema-utils'

describe('type', async () => {
  it('without map', async () => {
    const schema = type()
    const val = {}
    expect((await schema['~standard'].validate(val) as any).value).toBe(val)
  })

  it('with map', async () => {
    const val = {}
    const check = vi.fn().mockReturnValueOnce('__mapped__')
    const schema = type(check)
    expect((await schema['~standard'].validate(val) as any).value).toBe('__mapped__')
    expect(check).toHaveBeenCalledWith(val)
  })
})

describe('isSchemaIssue', async () => {
  it('works', () => {
    expect(isSchemaIssue({ message: 'hi' })).toBe(true)
    expect(isSchemaIssue({ message: 'hi', path: [] })).toBe(true)
    expect(isSchemaIssue({ message: 'hi', path: ['a', 1] })).toBe(true)
    expect(isSchemaIssue({ message: 'hi', path: [{ key: 'a' }, { key: 1 }] })).toBe(true)
    expect(isSchemaIssue({ message: 'hi', path: [{ key: 'a' }, 'b'] })).toBe(true)

    expect(isSchemaIssue({})).toBe(false)
    expect(isSchemaIssue({ message: 123 })).toBe(false)
    expect(isSchemaIssue({ message: 'hi', path: 'invalid' })).toBe(false)
    expect(isSchemaIssue({ message: 'hi', path: [{}] })).toBe(false)
  })

  it.each([
    ['zod', z.object({ a: z.number() })],
    ['valibot', v.object({ a: v.number() })],
    ['arktype', arktype.type({ a: 'number' })],
  ])('with schema: $0', async (name, schema) => {
    const { issues } = await schema['~standard'].validate({ a: 'invalid' })
    expect(issues?.every(isSchemaIssue)).toBe(true)
  })
})

describe('validateStackedInput', () => {
  const schemas = [
    z.object({ id: z.coerce.number() }),
    z.looseObject({ name: z.string().trim() }),
  ]

  it('validates each schema against the raw input with earlier results applied', async () => {
    const input = { id: '5', name: ' din ', extra: true }

    await expect(validateStackedInput(schemas, input, input)).resolves.toEqual({
      value: { id: 5, name: 'din', extra: true },
    })
  })

  it('pipes values that are not plain objects', async () => {
    const pipe = [z.string().transform(s => s.length), z.number().transform(n => n * 2)]

    await expect(validateStackedInput(pipe, 'abc', 'abc')).resolves.toEqual({ value: 6 })
  })

  it('returns the first issues with the value that was validated', async () => {
    const input = { id: '5', name: 123 }
    const result = await validateStackedInput(schemas, input, input)

    expect(result.issues).toHaveLength(1)
    expect(result.invalidData).toEqual({ id: 5, name: 123 })
  })

  it('validates only schemas from start to end, continuing from current', async () => {
    const validate = vi.fn((schema: any, value: unknown) => schema['~standard'].validate(value))
    const input = { id: '5', name: ' din ' }

    await expect(validateStackedInput(schemas, input, { id: 5 }, { start: 1, end: 2, validate })).resolves.toEqual({
      value: { id: 5, name: 'din' },
    })

    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledWith(schemas[1], { id: 5, name: ' din ' }, 1)

    await expect(validateStackedInput(schemas, input, input, { start: 1, end: 1, validate })).resolves.toEqual({ value: input })
    expect(validate).toHaveBeenCalledTimes(1)
  })
})
