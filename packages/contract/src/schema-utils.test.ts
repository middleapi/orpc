import * as arktype from 'arktype'
import * as v from 'valibot'
import z from 'zod'
import { isSchemaIssue, sanitizeSchemaIssues, type } from './schema-utils'

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

describe('sanitizeSchemaIssues', () => {
  it('keeps only message and path keys', () => {
    const symbol = Symbol('a')

    expect(sanitizeSchemaIssues([
      { message: 'a', extra: 'SECRET' } as any,
      { message: 'b', path: [] },
      { message: 'c', path: ['a', 1, symbol] },
      { message: 'd', path: [{ key: 'a', input: 'SECRET' }, { key: 1, value: 'SECRET' }, 'b'] as any },
    ])).toEqual([
      { message: 'a' },
      { message: 'b', path: [] },
      { message: 'c', path: ['a', 1, symbol] },
      { message: 'd', path: ['a', 1, 'b'] },
    ])
  })

  it('stops the path at the first segment that is not a property key', () => {
    expect(sanitizeSchemaIssues([
      { message: 'a', path: ['a', { key: { secret: 'SECRET' } }, 'b'] as any },
      { message: 'b', path: [{ key: null }, 'a'] as any },
      { message: 'c', path: ['a', null, 'b'] as any },
    ])).toEqual([
      { message: 'a', path: ['a'] },
      { message: 'b', path: [] },
      { message: 'c', path: ['a'] },
    ])
  })

  it.each([
    ['zod', z.object({ a: z.object({ b: z.string() }), c: z.string() })],
    ['valibot', v.object({ a: v.object({ b: v.string() }), c: v.string() })],
    ['arktype', arktype.type({ a: { b: 'string' }, c: 'string' })],
  ])('with schema: %s', async (_, schema) => {
    const { issues } = await schema['~standard'].validate({ a: { b: 1 }, secret: 'SECRET' })
    const sanitized = sanitizeSchemaIssues(issues!)

    expect(sanitized).toHaveLength(2)
    expect(sanitized).toEqual(expect.arrayContaining([
      { message: expect.any(String), path: ['a', 'b'] },
      { message: expect.any(String), path: ['c'] },
    ]))
    expect(JSON.stringify(sanitized)).not.toContain('SECRET')
  })
})
