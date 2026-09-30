import type { AnySchema } from './schema'
import * as arktype from 'arktype'
import * as v from 'valibot'
import z from 'zod'
import { asyncIteratorObject } from './schema-built-in'
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
  const validate = vi.fn(async (schema: AnySchema, value: unknown) => {
    const result = await schema['~standard'].validate(value)

    if (result.issues) {
      throw new Error(result.issues.map(issue => issue.path?.join('.')).join(', '))
    }

    return result.value
  })

  beforeEach(() => {
    validate.mockClear()
  })

  it('validates each later schema with the input and the results so far merged over it', async () => {
    const first = z.object({ id: z.coerce.number() })
    const second = z.object({ name: z.string().trim() })
    const third = z.object({ page: z.number() })
    const input = { id: '1', name: ' NAME ', page: 1, unknown: 'UNKNOWN' }

    await expect(validateStackedInput([first, second, third], input, validate))
      .resolves
      .toEqual({ id: 1, name: 'NAME', page: 1 })

    expect(validate).toHaveBeenCalledTimes(3)
    expect(validate).toHaveBeenNthCalledWith(1, first, input, 0)
    expect(validate).toHaveBeenNthCalledWith(2, second, { id: 1, name: ' NAME ', page: 1, unknown: 'UNKNOWN' }, 1)
    expect(validate).toHaveBeenNthCalledWith(3, third, { id: 1, name: 'NAME', page: 1, unknown: 'UNKNOWN' }, 2)
  })

  it('merges fragments inside arrays', async () => {
    await expect(validateStackedInput(
      [
        z.object({ items: z.array(z.object({ id: z.coerce.number() })) }),
        z.object({ items: z.array(z.object({ id: z.number(), qty: z.number() })) }),
        z.object({ items: z.array(z.object({ note: z.string() })) }),
      ],
      { items: [{ id: '1', qty: 1, note: 'A' }, { id: '2', qty: 2, note: 'B', unknown: 'UNKNOWN' }] },
      validate,
    )).resolves.toEqual({ items: [{ id: 1, qty: 1, note: 'A' }, { id: 2, qty: 2, note: 'B' }] })
  })

  it('merges fragments nested at any depth', async () => {
    await expect(validateStackedInput(
      [
        z.object({ filter: z.object({ range: z.object({ min: z.coerce.number() }) }) }),
        z.object({ filter: z.object({ range: z.object({ max: z.number() }) }) }),
      ],
      { filter: { range: { min: '1', max: 2, unknown: 'UNKNOWN' } } },
      validate,
    )).resolves.toEqual({ filter: { range: { min: 1, max: 2 } } })
  })

  it.each([
    ['zod', z.looseObject({ name: z.string() })],
    ['arktype', arktype.type({ name: 'string' })],
  ])('keeps earlier transforms when a later %s schema passes the raw values through', async (_, schema) => {
    await expect(validateStackedInput(
      [
        z.object({ id: z.coerce.number(), filter: z.object({ range: z.object({ min: z.coerce.number() }) }), items: z.array(z.object({ id: z.string().trim() })) }),
        schema,
      ],
      { id: '1', filter: { range: { min: '2' } }, items: [{ id: ' a ' }], name: 'NAME' },
      validate,
    )).resolves.toEqual({ id: 1, filter: { range: { min: 2 } }, items: [{ id: 'a' }], name: 'NAME' })
  })

  it('replaces an array that an earlier schema resized', async () => {
    await expect(validateStackedInput(
      [
        z.object({ items: z.array(z.object({ id: z.string() })).transform(items => items.slice(1)) }),
        z.looseObject({}),
      ],
      { items: [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }] },
      validate,
    )).resolves.toEqual({ items: [{ id: 'b' }] })
  })

  it('pipes values that are not plain objects or arrays', async () => {
    await expect(validateStackedInput(
      [
        type<string, string>(value => `first__${value}`),
        type<string, string>(value => `second__${value}`),
      ],
      'INPUT',
      validate,
    )).resolves.toBe('second__first__INPUT')

    const output = await validateStackedInput(
      [
        asyncIteratorObject(type<string, string>(value => `first__${value}`)),
        asyncIteratorObject(type<string, string>(value => `second__${value}`)),
      ],
      (async function* () { yield 'INPUT' })(),
      validate,
    ) as AsyncIterator<string>

    await expect(output.next()).resolves.toEqual({ done: false, value: 'second__first__INPUT' })
  })

  it('validates only the schemas between start and end, continuing from what the earlier ones returned', async () => {
    const schemas = [
      z.object({ id: z.coerce.number() }),
      z.object({ name: z.string().trim() }),
      z.object({ page: z.coerce.number() }),
    ]
    const input = { id: '1', name: ' NAME ', page: '1' }

    await expect(validateStackedInput(schemas, input, validate, { end: 1 }))
      .resolves
      .toEqual({ id: 1 })

    await expect(validateStackedInput(schemas, input, validate, { start: 1, end: 2, validated: { id: 1 } }))
      .resolves
      .toEqual({ id: 1, name: 'NAME' })

    await expect(validateStackedInput(schemas, input, validate, { start: 2, validated: { id: 1, name: 'NAME' } }))
      .resolves
      .toEqual({ id: 1, name: 'NAME', page: 1 })

    await expect(validateStackedInput(schemas, input, validate, { start: 1, end: 1, validated: { id: 1 } }))
      .resolves
      .toEqual({ id: 1 })

    expect(validate.mock.calls.map(call => call[0])).toEqual(schemas)
  })

  it('stops at the first schema that throws', async () => {
    const last = z.object({ name: z.string() })

    await expect(validateStackedInput(
      [
        z.object({ id: z.coerce.number() }),
        z.object({ page: z.number() }),
        last,
      ],
      { id: '1', name: 'NAME' },
      validate,
    )).rejects.toThrow('page')

    expect(validate).not.toHaveBeenCalledWith(last, expect.anything(), expect.anything())
  })
})
