import { BracketNotationSerializer } from './bracket-notation'

describe('bracket notation serializer', () => {
  const serializer = new BracketNotationSerializer()

  it('.stringifyPath', () => {
    expect(serializer.stringifyPath([])).toBe('')
    expect(serializer.stringifyPath([1])).toBe('1')
    expect(serializer.stringifyPath(['a', 'b', 'c', 1, 2, 3])).toBe('a[b][c][1][2][3]')
  })

  it('.parsePath', () => {
    expect(serializer.parsePath('')).toEqual([''])
    expect(serializer.parsePath('a[b][c][1][2][3]')).toEqual(['a', 'b', 'c', '1', '2', '3'])
    expect(serializer.parsePath('a[b]c[d]')).toEqual(['a', 'b]c[d'])
    expect(serializer.parsePath('a[b]c[d')).toEqual(['a[b]c[d'])
    expect(serializer.parsePath('a[[b]]')).toEqual(['a', '[b]'])
    expect(serializer.parsePath('abc[]')).toEqual(['abc', ''])

    expect(serializer.parsePath('abc[def')).toEqual(['abc[def'])
    expect(serializer.parsePath('abc[d]ef')).toEqual(['abc[d]ef'])
    expect(serializer.parsePath('abc[d][ef')).toEqual(['abc[d][ef'])
    expect(serializer.parsePath('abc[d][')).toEqual(['abc[d]['])
    expect(serializer.parsePath('abc[')).toEqual(['abc['])
    expect(serializer.parsePath('abc]')).toEqual(['abc]'])
  })

  it.each([
    [['a', 'b', 'c']],
    [['\\a', 'b', '\\c']],
    [['', '', '']],
  ])('.stringifyPath + .parsePath', (segments) => {
    expect(serializer.parsePath(serializer.stringifyPath(segments))).toEqual(segments)
  })

  describe('.serialize', () => {
    it('can serialize primitive values', () => {
      expect(serializer.serialize(1)).toEqual([
        ['', 1],
      ])
    })

    it('can serialize objects', () => {
      expect(serializer.serialize({ a: 1, b: 2, c: 3 })).toEqual([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ])
    })

    it('can serialize arrays', () => {
      expect(serializer.serialize([1, 2, 3])).toEqual([
        ['0', 1],
        ['1', 2],
        ['2', 3],
      ])
    })

    it('can serialize nested objects', () => {
      expect(serializer.serialize({ a: { b: { c: 1, d: 2 }, e: 3, f: 4 } })).toEqual([
        ['a[b][c]', 1],
        ['a[b][d]', 2],
        ['a[e]', 3],
        ['a[f]', 4],
      ])
    })

    it('can serialize nested arrays', () => {
      expect(serializer.serialize({ a: [[1, 2], 3, 4] })).toEqual([
        ['a[0][0]', 1],
        ['a[0][1]', 2],
        ['a[1]', 3],
        ['a[2]', 4],
      ])
    })

    it('can serialize mixed nested structures', () => {
      expect(serializer.serialize({ a: { b: 1, c: [2, { d: 3, f: 4 }] } })).toEqual([
        ['a[b]', 1],
        ['a[c][0]', 2],
        ['a[c][1][d]', 3],
        ['a[c][1][f]', 4],
      ])
    })
  })

  describe('.deserialize', () => {
    it('can deserialize empty objects', () => {
      expect(serializer.deserialize([])).toEqual({})
    })

    it('can deserialize arrays', () => {
      expect(serializer.deserialize([
        ['a[]', 1],
        ['a[]', 2],
        ['a[]', 3],
      ])).toEqual({ a: [1, 2, 3] })

      expect(serializer.deserialize([
        ['a[0]', 1],
        ['a[1]', 2],
        ['a[2]', 3],
      ])).toEqual({ a: [1, 2, 3] })
    })

    it('can deserialize array missing items', () => {
      expect(serializer.deserialize([
        ['a[0]', 1],
        ['a[2]', 3],
      ])).toEqual({ a: [1, undefined, 3] })
    })

    it('deserializes root-level array notation as objects', () => {
      expect(serializer.deserialize([
        ['', 1],
        ['', 2],
        ['', 3],
      ])).toEqual({ '': [1, 2, 3] })

      expect(serializer.deserialize([
        ['0', 1],
        ['1', 2],
        ['2', 3],
      ])).toEqual({ 0: 1, 1: 2, 2: 3 })
    })

    it('deserializes sparse root-level array notation as objects', () => {
      expect(serializer.deserialize([
        ['0', 1],
        ['2', 2],
      ])).toEqual({ 0: 1, 2: 2 })
    })

    it('can deserialize objects', () => {
      expect(serializer.deserialize([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ])).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('can deserialize number-key objects', () => {
      expect(serializer.deserialize([
        ['0', 1],
        ['1', 2],
        ['a', 3],
      ])).toEqual({ 0: 1, 1: 2, a: 3 })

      expect(serializer.deserialize([
        ['a', 3],
        ['0', 1],
        ['1', 2],
      ])).toEqual({ 0: 1, 1: 2, a: 3 })
    })

    it('can deserialize empty-key objects', () => {
      expect(serializer.deserialize([
        ['', 1],
        ['a', 3],
      ])).toEqual({ '': 1, 'a': 3 })

      expect(serializer.deserialize([
        ['a', 3],
        ['', 1],
      ])).toEqual({ '': 1, 'a': 3 })

      expect(serializer.deserialize([
        ['[a]', 1],
        ['[b]', 3],
      ])).toEqual({ '': { a: 1, b: 3 } })
    })

    it('can deserialize objects when both number-key and empty-key appear', () => {
      expect(serializer.deserialize([
        ['0', 1],
        ['', 2],
      ])).toEqual({ '0': 1, '': 2 })
      expect(serializer.deserialize([
        ['', 2],
        ['0', 1],
      ])).toEqual({ '0': 1, '': 2 })
    })

    it('should be an array if conflict keys', () => {
      expect(serializer.deserialize([
        ['a', 1],
        ['a', 2],
      ])).toEqual({ a: [1, 2] })

      expect(serializer.deserialize([
        ['0', 1],
        ['0', 2],
      ])).toEqual({ 0: [1, 2] })

      expect(serializer.deserialize([
        ['a', 1],
        ['a', 2],
        ['a[2]', 3],
      ])).toEqual({ a: [1, 2, 3] })

      expect(serializer.deserialize([
        ['0', 1],
        ['0', 2],
        ['0[user]', 3],
      ])).toEqual({
        0: {
          0: 1,
          1: 2,
          user: 3,
        },
      })
    })

    it('should be an array if [] conflict keys', () => {
      expect(serializer.deserialize([
        ['users[]', 1],
        ['users[]', 2],
        ['users[name]', 3],
      ])).toEqual({
        users: {
          '': [1, 2],
          'name': 3,
        },
      })

      expect(serializer.deserialize([
        ['users[]', 1],
        ['users[]', 2],
        ['users[name][]', 3],
        ['users[name][]', 4],
        ['users[]', 5],
        ['users[name][]', 6],
      ])).toEqual({
        users: {
          '': [1, 2, 5],
          'name': [3, 4, 6],
        },
      })

      expect(serializer.deserialize([
        ['a[]', 1],
        ['a[b][]', 2],
        ['a[b][c][]', 3],
        ['a[]', 4],
        ['a[b][]', 5],
        ['a[b][c][]', 6],
      ])).toEqual({
        a: {
          '': [1, 4],
          'b': {
            '': [2, 5],
            'c': [3, 6],
          },
        },
      })
    })

    it('can deserialize mixed nested structures', () => {
      expect(serializer.deserialize([
        ['a[b]', 1],
        ['a[c][0]', 2],
        ['a[c][1][d]', 3],
        ['a[c][1][f]', 4],
      ])).toEqual({ a: { b: 1, c: [2, { d: 3, f: 4 }] } })
    })

    it('fallback to object when explicit array index exceeds maxExplicitDeserializingArrayIndex (default 999)', () => {
      expect(serializer.deserialize([
        ['arr[1]', 1],
        ['arr[999]', 2],
        ['arr[1000]', 3],
      ])).toEqual({ arr: { 1: 1, 999: 2, 1000: 3 } })

      expect(serializer.deserialize([
        ['arr[999]', 3],
      ])).toEqual({ arr: (() => {
        const arr = []
        arr[999] = 3
        return arr
      })() })

      expect(serializer.deserialize([
        ['arr[1000]', 3],
      ])).toEqual({ arr: { 1000: 3 } })

      // the limit not apply to push array syntax
      expect(serializer.deserialize([
        ['arr[999]', 3],
        ['arr', 4],
      ])).toEqual({
        arr: (() => {
          const arr = []
          arr[999] = 3
          arr[1000] = 4
          return arr
        })(),
      })

      const customSerializer = new BracketNotationSerializer({ maxExplicitDeserializingArrayIndex: 499 })

      expect(customSerializer.deserialize([
        ['arr[1]', 1],
        ['arr[499]', 2],
        ['arr[500]', 3],
      ])).toEqual({ arr: { 1: 1, 499: 2, 500: 3 } })

      expect(customSerializer.deserialize([
        ['arr[499]', 2],
      ])).toEqual({ arr: (() => {
        const arr = []
        arr[499] = 2
        return arr
      })() })
    })

    it('can prevent prototype pollution attack', () => {
      /* eslint-disable no-proto, no-restricted-properties */
      const result = serializer.deserialize([
        ['__proto__[polluted]', '1'],
        ['constructor[polluted]', '2'],
        ['nested[__proto__][polluted]', '3'],
        ['nested[constructor][polluted]', '4'],
        ['arr[]', '5'],
        ['arr[__proto__][polluted]', '6'],
        ['arr[constructor][polluted]', '7'],
      ]) as any

      // dangerous keys are stored as plain data on NullProtoObj, not as real prototype links
      expect(result.__proto__).toEqual({ polluted: '1' })
      expect(result.constructor).toEqual({ polluted: '2' })
      expect(result.nested.__proto__).toEqual({ polluted: '3' })
      expect(result.nested.constructor).toEqual({ polluted: '4' })
      expect(result.arr['']).toEqual('5')
      expect(result.arr.__proto__).toEqual({ polluted: '6' })
      expect(result.arr.constructor).toEqual({ polluted: '7' })

      // stored keys must not be reachable via normal property lookup (would indicate real prototype mutation)
      expect(result.polluted).toBeUndefined()
      expect(result.nested.polluted).toBeUndefined()
      expect(result.arr.polluted).toBeUndefined()

      // global Object prototype must be completely unaffected
      expect(({} as any).__proto__.polluted).toBeUndefined()
      expect(({} as any).constructor.polluted).toBeUndefined()
      expect(({} as any).polluted).toBeUndefined()
      /* eslint-enable no-proto, no-restricted-properties */
    })
  })

  it.each([
    [{ }],
    [{ a: 1, b: 2, c: [1, 2, { a: 1, b: 2 }, new Date(), new Blob([]), new Set([1, 2]), new Map([[1, 2]])] }],
  ])('.serialize + .deserialize', (value) => {
    expect(serializer.deserialize(serializer.serialize(value))).toEqual(value)
  })

  it('does not round-trip root-level arrays', () => {
    expect(serializer.deserialize(serializer.serialize([1, 2, 3]))).toEqual({
      0: 1,
      1: 2,
      2: 3,
    })
  })
})
