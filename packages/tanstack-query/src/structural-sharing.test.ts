import { RPCJsonSerializer } from '@orpc/client'
import { NullProtoObj } from '@orpc/shared'
import { replaceEqualDeep } from '@tanstack/query-core'
import { createStructuralSharing } from './structural-sharing'

const structuralSharing = createStructuralSharing()

class Planet {}

class Person {
  constructor(public name: string, public born: Date) {}
}

class Box {
  constructor(public value: unknown) {}
}

describe('structuralSharing', () => {
  it('keeps the old reference for equal data', () => {
    const create = () => ({
      date: new Date('2025-01-01'),
      invalidDate: new Date(Number.NaN),
      url: new URL('https://orpc.dev/docs'),
      set: new Set([1, 'a', new Date('2025-01-01')]),
      map: new Map<unknown, unknown>([['a', { date: new Date('2025-01-01') }], [1, [new Date('2025-01-02')]]]),
      nan: Number.NaN,
      bigint: 1n,
      undefined,
      nested: [{ a: 1 }, null, 'b'],
    })

    const old = create()
    expect(structuralSharing(old, create())).toBe(old)
    // TanStack Query's default replaces everything
    expect(replaceEqualDeep(old, create())).not.toBe(old)
  })

  it('keeps unchanged parts and takes changed ones', () => {
    const old = { a: { date: new Date('2025-01-01') }, b: { date: new Date('2025-01-01') } }
    const next = { a: { date: new Date('2025-01-01') }, b: { date: new Date('2025-01-02') } }

    const result = structuralSharing(old, next)
    expect(result).toEqual(next)
    expect(result.a).toBe(old.a)
    expect(result.b.date).toBe(next.b.date)
  })

  it.each([
    ['date', new Date('2025-01-01'), new Date('2025-01-02')],
    ['url', new URL('https://orpc.dev/a'), new URL('https://orpc.dev/b')],
    ['negative zero', 0, -0],
    ['set size', new Set([1]), new Set([1, 2])],
    ['set member', new Set([new Date('2025-01-01')]), new Set([new Date('2025-01-02')])],
    ['set order', new Set([1, 2]), new Set([2, 1])],
    ['different types', new Date('2025-01-01'), '2025-01-01T00:00:00.000Z'],
    ['different prototypes', new Map(), new Set()],
    ['class instances', new Planet(), new Planet()],
    ['sparse arrays', [1, , 3], [1, , 3]], // eslint-disable-line no-sparse-arrays
  ])('takes new data when %s differs', (_, old, next) => {
    expect(structuralSharing({ value: old }, { value: next }).value).toBe(next)
  })

  it('shares maps all or nothing', () => {
    const create = () => new Map<unknown, unknown>([['a', { date: new Date('2025-01-01') }], [{ id: 1 }, 'object key']])
    const old = create()
    expect(structuralSharing(old, create())).toBe(old)

    for (const next of [
      new Map([...create()].map(([key, value]) => [key, key === 'a' ? { date: new Date('2025-01-02') } : value])),
      new Map([...create()].reverse()),
    ]) {
      expect(structuralSharing(old, next)).toBe(next)
    }
  })

  it('shares array items', () => {
    const old = [{ id: 1 }, { id: 2 }]
    const next = [{ id: 1 }, { id: 2 }, { id: 3 }]

    const result = structuralSharing(old, next)
    expect(result).toEqual(next)
    expect(result[0]).toBe(old[0])
    expect(result[1]).toBe(old[1])
    expect(result[2]).toBe(next[2])

    expect(structuralSharing(next, old)).toEqual(old)
  })

  it('handles key changes on objects', () => {
    const old = { a: 1, b: 2 } as Record<string, number>
    expect(structuralSharing(old, { a: 1, c: 2 })).toEqual({ a: 1, c: 2 })
    expect(structuralSharing(old, { a: 1 })).toEqual({ a: 1 })
    expect(structuralSharing({ a: undefined }, { b: undefined })).toEqual({ b: undefined })
  })

  it('shares null-prototype objects', () => {
    const old = Object.assign(new NullProtoObj(), { date: new Date('2025-01-01') })
    const next = Object.assign(new NullProtoObj(), { date: new Date('2025-01-01') })

    expect(structuralSharing(old, next)).toBe(old)
  })

  it('keeps __proto__ as an own key', () => {
    const old = JSON.parse('{"__proto__":{"a":1},"b":1}')
    const next = JSON.parse('{"__proto__":{"a":1},"b":2}')

    const result = structuralSharing(old, next)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe(Object.getOwnPropertyDescriptor(old, '__proto__')!.value)
    expect(result.b).toBe(2)
  })

  it('gives up sharing past 500 levels', () => {
    const deep = () => {
      let value: any = { leaf: true }
      for (let i = 0; i < 600; i++) {
        value = { value }
      }
      return value
    }

    const old = deep()
    const next = deep()
    const result = structuralSharing(old, next)
    expect(result).not.toBe(old)
    expect(result).toEqual(next)
  })

  describe('with a serializer', () => {
    const sharing = createStructuralSharing(new RPCJsonSerializer({
      handlers: {
        person: {
          condition: value => value instanceof Person,
          // not terminal, so the Date inside is serialized by the built-in handler
          serialize: (value: Person) => [value.name, value.born],
          deserialize: ([name, born]: any) => new Person(name, born),
        },
        box: {
          condition: value => value instanceof Box,
          serialize: (value: Box) => value.value,
          deserialize: value => new Box(value),
        },
      },
    }))

    it('keeps equal instances of types with custom handlers', () => {
      const old = { people: [new Person('Earth', new Date('2025-01-01'))] }

      expect(sharing(old, { people: [new Person('Earth', new Date('2025-01-01'))] })).toBe(old)
      expect(structuralSharing(old, { people: [new Person('Earth', new Date('2025-01-01'))] })).not.toBe(old)
    })

    it('takes new instances when their serialized form differs', () => {
      const old = new Person('Earth', new Date('2025-01-01'))

      for (const next of [new Person('Mars', new Date('2025-01-01')), new Person('Earth', new Date('2025-01-02'))]) {
        expect(sharing(old, next)).toBe(next)
      }
    })

    it.each([
      ['type', new Date(0), 0n],
      ['type count', new Date(0), '1970-01-01T00:00:00.000Z'],
      ['type path', { a: new Date(0) }, { b: new Date(0) }],
      ['type depth', { a: new Date(0) }, { a: { b: new Date(0) } }],
    ])('takes new instances when a nested %s differs', (_, old, next) => {
      const nextBox = new Box(next)
      expect(sharing(new Box(old), nextBox)).toBe(nextBox)
    })

    it('takes new instances of types without a handler', () => {
      const next = new Planet()
      expect(sharing(new Planet(), next)).toBe(next)
    })
  })

  it('handles non-object data', () => {
    expect(structuralSharing(undefined, 1)).toBe(1)
    expect(structuralSharing(1, 1)).toBe(1)
    expect(structuralSharing(Number.NaN, Number.NaN)).toBe(Number.NaN)
    expect(structuralSharing(null, { a: 1 })).toEqual({ a: 1 })
    const fn = () => {}
    expect(structuralSharing(() => {}, fn)).toBe(fn)
  })
})
