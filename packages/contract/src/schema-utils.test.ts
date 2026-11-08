import * as arktype from 'arktype'
import * as v from 'valibot'
import * as z from 'zod'

import { asyncIteratorObject } from './schema-built-in.ts'
import { getInputSchemaValue, isSchemaIssue, type, validateInputSchemas } from './schema-utils.ts'

describe('type', async () => {
  it('without map', async () => {
    const schema = type()
    const val = {}
    expect(((await schema['~standard'].validate(val)) as any).value).toBe(val)
  })

  it('with map', async () => {
    const val = {}
    const check = vi.fn().mockReturnValueOnce('__mapped__')
    const schema = type(check)
    expect(((await schema['~standard'].validate(val)) as any).value).toBe('__mapped__')
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

describe('validateInputSchemas', () => {
  it('returns the input as is without schemas', async () => {
    const input = { a: 1 }
    expect(((await validateInputSchemas([], input)) as any).value).toBe(input)
  })

  it('composes object fragments and drops fields no schema defines', async () => {
    await expect(
      validateInputSchemas([z.object({ a: z.string() }), z.object({ b: z.string() })], {
        a: 'a',
        b: 'b',
        unknown: 'unknown',
      }),
    ).resolves.toEqual({ value: { a: 'a', b: 'b' } })
  })

  it('composes fragments nested one level deep', async () => {
    await expect(
      validateInputSchemas(
        [
          z.object({ params: z.object({ id: z.string() }) }),
          z.object({
            params: z.object({ slug: z.string() }),
            query: z.object({ page: z.number() }),
          }),
        ],
        { params: { id: 'ID', slug: 'SLUG', unknown: 'unknown' }, query: { page: 1 } },
      ),
    ).resolves.toEqual({ value: { params: { id: 'ID', slug: 'SLUG' }, query: { page: 1 } } })
  })

  it('gives later schemas what earlier ones returned, so loose schemas keep earlier transforms', async () => {
    await expect(
      validateInputSchemas(
        [
          z.object({ id: z.coerce.number(), page: z.coerce.number() }),
          z.looseObject({ name: z.string() }),
          z.object({ page: z.number().transform((page) => page * 2) }),
        ],
        { id: '5', page: '1', name: 'NAME' },
      ),
    ).resolves.toEqual({ value: { id: 5, page: 2, name: 'NAME' } })
  })

  it('pipes values that are not plain objects', async () => {
    const result = (await validateInputSchemas(
      [
        asyncIteratorObject(type<string, string>((value) => `first__${value}`)),
        asyncIteratorObject(type<string, string>((value) => `second__${value}`)),
      ],
      (async function* () {
        yield 'INPUT'
      })(),
    )) as any

    await expect(result.value.next()).resolves.toEqual({
      done: false,
      value: 'second__first__INPUT',
    })
  })

  it('stops at the first failing schema and reports what it validated', async () => {
    const third = z.object({ c: z.string() })
    const validateSpy = vi.spyOn(third['~standard'], 'validate')

    const result = await validateInputSchemas(
      [z.object({ a: z.coerce.number() }), z.object({ b: z.string() }), third],
      { a: '1', c: 'c' },
    )

    expect(result).toEqual({
      issues: [expect.objectContaining({ path: ['b'] })],
      invalidData: { a: 1, c: 'c' },
    })
    expect(validateSpy).not.toHaveBeenCalled()
  })

  it('validates a segment, continuing from what the earlier schemas returned', async () => {
    const schemas = [
      z.object({ a: z.coerce.number() }),
      z.object({ b: z.coerce.number() }),
      z.object({ c: z.coerce.number() }),
    ]
    const input = { a: '1', b: '2', c: '3' }

    const first = (await validateInputSchemas(schemas, input, { to: 1 })) as any
    expect(first).toEqual({ value: { a: 1 } })

    const middle = (await validateInputSchemas(schemas, input, {
      from: 1,
      to: 2,
      current: first.value,
    })) as any
    expect(middle).toEqual({ value: { a: 1, b: 2 } })

    await expect(
      validateInputSchemas(schemas, input, { from: 2, current: middle.value }),
    ).resolves.toEqual({ value: { a: 1, b: 2, c: 3 } })

    await expect(
      validateInputSchemas(schemas, input, { from: 2, to: 2, current: middle.value }),
    ).resolves.toEqual({ value: middle.value })
  })

  it('treats current as the previous result, even when it is undefined', async () => {
    await expect(
      validateInputSchemas([z.any(), z.undefined()], { a: 1 }, { from: 1, current: undefined }),
    ).resolves.toEqual({ value: undefined })
  })

  it('ignores current when starting from the first schema', async () => {
    await expect(
      validateInputSchemas([z.object({ a: z.string() })], { a: 'a' }, { current: { a: 'other' } }),
    ).resolves.toEqual({ value: { a: 'a' } })
  })

  it('runs every schema through a custom validate', async () => {
    const validate = vi.fn((schema: any, value: unknown) => schema['~standard'].validate(value))
    const schemas = [z.object({ a: z.coerce.number() }), z.object({ b: z.string() })]

    await expect(validateInputSchemas(schemas, { a: '1', b: 'b' }, { validate })).resolves.toEqual({
      value: { a: 1, b: 'b' },
    })

    expect(validate).toHaveBeenCalledTimes(2)
    expect(validate).toHaveBeenNthCalledWith(1, schemas[0], { a: '1', b: 'b' }, 0)
    expect(validate).toHaveBeenNthCalledWith(2, schemas[1], { a: 1, b: 'b' }, 1)
  })
})

describe('getInputSchemaValue', () => {
  it('gives the first schema the current value as is', () => {
    const current = { a: 1 }
    expect(getInputSchemaValue({ a: 'raw' }, current, 0)).toBe(current)
  })

  it('applies the current value over the original input for later schemas', () => {
    expect(getInputSchemaValue({ a: 'raw', b: 'raw' }, { a: 1 }, 1)).toEqual({ a: 1, b: 'raw' })
  })

  it('pipes values that are not plain objects', () => {
    expect(getInputSchemaValue({ a: 'raw' }, 'current', 1)).toBe('current')
  })
})
