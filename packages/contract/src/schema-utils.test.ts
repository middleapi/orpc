import * as arktype from 'arktype'
import * as v from 'valibot'
import z from 'zod'
import { isSchemaIssue, toPublicSchemaIssues, type } from './schema-utils'

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

describe('toPublicSchemaIssues', () => {
  it('keeps only message and path', () => {
    const issues = toPublicSchemaIssues([
      { message: 'a', path: ['x', 0], kind: 'schema', input: 'SECRET', received: '"SECRET"', expected: 'number', requirement: 1 } as any,
      { message: 'b', path: ['y'], data: 'SECRET', code: 'invalid_type' } as any,
    ])

    expect(issues).toEqual([
      { message: 'a', path: ['x', 0] },
      { message: 'b', path: ['y'] },
    ])
    expect(issues.map(issue => Object.keys(issue))).toEqual([['message', 'path'], ['message', 'path']])
  })

  it('omits path when undefined', () => {
    const issues = toPublicSchemaIssues([{ message: 'a', input: 'SECRET' } as any])

    expect(issues).toEqual([{ message: 'a' }])
    expect(issues[0]).not.toHaveProperty('path')
  })

  it('replaces object segments with their keys', () => {
    const symbol = Symbol('key')

    expect(toPublicSchemaIssues([{
      message: 'a',
      path: [
        { key: 'x', input: { secret: 'SECRET' }, value: 'SECRET' } as any,
        1,
        { key: 2 },
        { key: symbol },
        'y',
      ],
    }])).toEqual([{ message: 'a', path: ['x', 1, 2, symbol, 'y'] }])
  })

  it('truncates the path at the first key that is not a property key', () => {
    expect(toPublicSchemaIssues([
      { message: 'a', path: ['x', { key: { secret: 'SECRET' } }, 'y'] } as any,
      { message: 'b', path: [{ key: null }, 'y'] } as any,
      { message: 'c', path: ['x', null, 'y'] } as any,
    ])).toEqual([
      { message: 'a', path: ['x'] },
      { message: 'b', path: [] },
      { message: 'c', path: ['x'] },
    ])
  })

  it.each([
    ['zod', z.object({ a: z.number(), m: z.map(z.string(), z.number()) })],
    ['valibot', v.object({ a: v.number(), m: v.map(v.any(), v.number()), s: v.set(v.number()) })],
    ['arktype', arktype.type({ a: 'number', m: arktype.type.instanceOf(Map) })],
  ])('with schema: $0', async (name, schema) => {
    const { issues } = await schema['~standard'].validate({
      a: 'SECRET',
      m: new Map<unknown, unknown>([[{ secret: 'SECRET' }, 'SECRET']]),
      s: new Set(['SECRET']),
    })

    const publicIssues = toPublicSchemaIssues(issues!)

    expect(publicIssues.length).toBeGreaterThan(0)
    expect(publicIssues.every(isSchemaIssue)).toBe(true)
    expect(publicIssues).toContainEqual({ message: expect.any(String), path: ['a'] })

    for (const issue of publicIssues) {
      expect(Object.keys(issue).every(key => key === 'message' || key === 'path')).toBe(true)
      expect(issue.path?.every(segment => typeof segment !== 'object')).toBe(true)
    }
  })
})
