import { isDeepEqual } from './compare'

describe('deepEqual', () => {
  it('returns true for the same primitive reference', () => {
    expect(isDeepEqual('value', 'value')).toBe(true)
    expect(isDeepEqual(1, 1)).toBe(true)
    expect(isDeepEqual(true, true)).toBe(true)
  })

  it('returns true for NaN values', () => {
    expect(isDeepEqual(Number.NaN, Number.NaN)).toBe(true)
  })

  it('treats 0 and -0 as equal', () => {
    expect(isDeepEqual(0, -0)).toBe(true)
    expect(isDeepEqual({ minimum: 0 }, { minimum: -0 })).toBe(true)
  })

  it('returns false for values with different types', () => {
    expect(isDeepEqual(1, '1')).toBe(false)
  })

  it('returns false for unequal primitives of the same type', () => {
    expect(isDeepEqual(1, 2)).toBe(false)
  })

  it('returns false when only the left side is null', () => {
    expect(isDeepEqual(null, {})).toBe(false)
  })

  it('returns false when only the right side is null', () => {
    expect(isDeepEqual({}, null)).toBe(false)
  })

  it('returns false when comparing an array to an object', () => {
    expect(isDeepEqual([], {})).toBe(false)
  })

  it('returns false for arrays with different lengths', () => {
    expect(isDeepEqual([1], [1, 2])).toBe(false)
  })

  it('returns false for objects with different key counts', () => {
    expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('returns true when different keys only contain undefined values', () => {
    expect(isDeepEqual({ a: undefined }, { b: undefined })).toBe(true)
  })

  it('returns true for deeply equal nested values', () => {
    expect(isDeepEqual(
      {
        items: [1, { enabled: true }],
        meta: { count: 2 },
      },
      {
        items: [1, { enabled: true }],
        meta: { count: 2 },
      },
    )).toBe(true)
  })

  it('returns false for deeply unequal nested values', () => {
    expect(isDeepEqual(
      {
        items: [1, { enabled: true }],
      },
      {
        items: [1, { enabled: false }],
      },
    )).toBe(false)
  })

  it('can handle recursive object', () => {
    const a = {
      u: [1, 2, 3],
      get c() {
        return a
      },
    }

    const b = {
      u: [1, 2, 3],
      get c() {
        return b
      },
    }

    expect(isDeepEqual(a, b)).toBeTruthy()
  })

  it('returns false for unequal recursive objects', () => {
    const a = {
      u: [1, 2, 3],
      get c() {
        return a
      },
    }

    const b = {
      u: [1, 2, 4],
      get c() {
        return b
      },
    }

    expect(isDeepEqual(a, b)).toBe(false)
  })

  it('returns true when one side reuses a reference and the other duplicates the value', () => {
    const shared = { value: 1 }

    expect(isDeepEqual(
      {
        left: shared,
        right: shared,
      },
      {
        left: { value: 1 },
        right: { value: 1 },
      },
    )).toBe(true)
  })

  it('compares Date values by time', () => {
    expect(isDeepEqual(new Date(1), new Date(1))).toBe(true)
    expect(isDeepEqual(new Date(Number.NaN), new Date(Number.NaN))).toBe(true)
    expect(isDeepEqual(new Date(1), new Date(2))).toBe(false)
    expect(isDeepEqual({ at: new Date(1) }, { at: new Date(2) })).toBe(false)
    expect(isDeepEqual(new Date(1), {})).toBe(false)
    expect(isDeepEqual({}, new Date(1))).toBe(false)
  })

  it('compares RegExp values by source and flags', () => {
    expect(isDeepEqual(/a/g, /a/g)).toBe(true)
    expect(isDeepEqual(/a/, /b/)).toBe(false)
    expect(isDeepEqual(/a/g, /a/i)).toBe(false)
    expect(isDeepEqual({ pattern: /a/ }, { pattern: /b/ })).toBe(false)
    expect(isDeepEqual(/a/, {})).toBe(false)
    expect(isDeepEqual({}, /a/)).toBe(false)
  })

  it('compares Map values by entries', () => {
    expect(isDeepEqual(new Map([['a', { value: 1 }]]), new Map([['a', { value: 1 }]]))).toBe(true)
    expect(isDeepEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false)
    expect(isDeepEqual(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false)
    expect(isDeepEqual(new Map([['a', 1]]), new Map([['a', 1], ['b', 2]]))).toBe(false)
    expect(isDeepEqual(new Map([['a', undefined]]), new Map([['b', undefined]]))).toBe(false)
    expect(isDeepEqual(new Map(), {})).toBe(false)
    expect(isDeepEqual({}, new Map())).toBe(false)
  })

  it('can handle recursive Map', () => {
    const a = new Map<string, unknown>([['value', 1]])
    a.set('self', a)
    const b = new Map<string, unknown>([['value', 1]])
    b.set('self', b)
    const c = new Map<string, unknown>([['value', 2]])
    c.set('self', c)

    expect(isDeepEqual(a, b)).toBe(true)
    expect(isDeepEqual(a, c)).toBe(false)
  })

  it('compares Set values by members', () => {
    expect(isDeepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true)
    expect(isDeepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false)
    expect(isDeepEqual(new Set([1]), new Set([1, 2]))).toBe(false)
    expect(isDeepEqual(new Set(), new Map())).toBe(false)
    expect(isDeepEqual(new Set(), {})).toBe(false)
    expect(isDeepEqual({}, new Set())).toBe(false)
  })
})
