import { RPCJsonSerializer } from '@orpc/client'
import { unstable_serialize } from 'swr'
import { deserializeOperationKeyInput, generateOperationKey } from './key'

describe('generateOperationKey', () => {
  it('without prefix', () => {
    expect(generateOperationKey(['ping'])).toEqual([['ping'], {}])
    expect(generateOperationKey(['ping'], { input: { search: '__search__' } })).toEqual([['ping'], { input: { search: '__search__' } }])
  })

  it('with prefix', () => {
    expect(generateOperationKey(['ping'], { prefix: '__prefix__' })).toEqual(['__prefix__', ['ping'], {}])
    expect(generateOperationKey(['ping'], { prefix: '__prefix__', input: { search: '__search__' } })).toEqual(['__prefix__', ['ping'], { input: { search: '__search__' } }])
  })

  it('serializes the input', () => {
    expect(generateOperationKey(['ping'], {
      input: {
        ids: new Set([1, 2]),
        map: new Map([['a', 1n]]),
        big: 1n,
        since: new Date('2024-01-01'),
        omitted: undefined,
      },
    })).toEqual([['ping'], {
      input: {
        ids: [1, 2],
        map: [['a', '1']],
        big: '1',
        since: '2024-01-01T00:00:00.000Z',
      },
      inputMeta: {
        '["ids"]': ['set'],
        '["map",0,1]': ['bigint'],
        '["map"]': ['map'],
        '["big"]': ['bigint'],
        '["since"]': ['date'],
      },
    }])
  })

  it('uses a custom serializer', () => {
    class Point {
      constructor(public x: number, public y: number) {}
    }

    const serializer = new RPCJsonSerializer({
      handlers: {
        point: {
          condition: (value: unknown) => value instanceof Point,
          serialize: (value: Point) => [value.x, value.y],
          deserialize: ([x, y]: [number, number]) => new Point(x, y),
          isTerminal: true,
        },
      },
    })

    expect(generateOperationKey(['ping'], { serializer, input: { at: new Point(1, 2) } }))
      .toEqual([['ping'], { input: { at: [1, 2] }, inputMeta: { '["at"]': ['point'] } }])
  })

  describe.each<[string, () => unknown, () => unknown]>([
    ['Set', () => ({ ids: new Set([1, 2]) }), () => ({ ids: new Set([2, 1]) })],
    ['Map', () => ({ map: new Map([['a', 1]]) }), () => ({ map: new Map([['a', 2]]) })],
    ['BigInt', () => ({ value: 1n }), () => ({ value: 2n })],
    ['Date', () => ({ since: new Date('2024-01-01') }), () => ({ since: new Date('2024-01-02') })],
  ])('%s input', (_, create, createDifferent) => {
    it('produces equal SWR cache keys for equal inputs', () => {
      const a = generateOperationKey(['ping'], { input: create() })
      const b = generateOperationKey(['ping'], { input: create() })

      expect(a).toEqual(b)
      expect(unstable_serialize(a)).toBe(unstable_serialize(b))
    })

    it('produces different SWR cache keys for different inputs', () => {
      const a = generateOperationKey(['ping'], { input: create() })
      const b = generateOperationKey(['ping'], { input: createDifferent() })

      expect(unstable_serialize(a)).not.toBe(unstable_serialize(b))
    })

    it('round-trips through deserializeOperationKeyInput', () => {
      const input = create()

      expect(deserializeOperationKeyInput(generateOperationKey(['ping'], { input }))).toEqual(input)
    })
  })

  it('distinguishes values that share a JSON form', () => {
    const hash = (input: unknown) => unstable_serialize(generateOperationKey(['ping'], { input }))

    expect(hash({ a: 1n })).not.toBe(hash({ a: 1 }))
    expect(hash({ a: 1n })).not.toBe(hash({ a: '1' }))
    expect(hash({ a: new Date('2024-01-01') })).not.toBe(hash({ a: '2024-01-01T00:00:00.000Z' }))
    expect(hash({ a: new Set([1]) })).not.toBe(hash({ a: [1] }))
    expect(hash({ a: new Map([[1, 2]]) })).not.toBe(hash({ a: [[1, 2]] }))
  })
})

describe('deserializeOperationKeyInput', () => {
  it('returns undefined when the key has no input', () => {
    expect(deserializeOperationKeyInput(generateOperationKey(['ping']))).toBeUndefined()
    expect(deserializeOperationKeyInput(generateOperationKey(['ping'], { prefix: '__prefix__' }))).toBeUndefined()
  })

  it('returns JSON inputs as is', () => {
    const key = generateOperationKey(['ping'], { prefix: '__prefix__', input: { search: '__search__' } })

    expect(deserializeOperationKeyInput(key)).toBe((key[2] as any).input)
  })

  it('restores nested types without mutating the key', () => {
    const input = {
      ids: new Set([new Date('2024-01-01'), new Date('2024-01-02')]),
      map: new Map<unknown, unknown>([[new Date('2024-01-03'), new Set([1n])], ['b', undefined]]),
      list: [undefined, Number.NaN, Number.POSITIVE_INFINITY, new URL('https://orpc.dev')],
    }

    const key = generateOperationKey(['ping'], { input })
    const snapshot = structuredClone(key)

    expect(deserializeOperationKeyInput(key)).toEqual(input)
    expect(key).toEqual(snapshot)
  })

  it('restores inputs regardless of inputMeta order', () => {
    const input = { ids: new Set([new Date('2024-01-01')]) }
    const [path, content] = generateOperationKey(['ping'], { input }) as [string[], any]

    const reversed = Object.fromEntries(Object.entries(content.inputMeta).reverse())
    expect(Object.keys(reversed)).not.toEqual(Object.keys(content.inputMeta))

    expect(deserializeOperationKeyInput([path, { ...content, inputMeta: reversed }])).toEqual(input)
  })

  it('uses a custom serializer', () => {
    class Point {
      constructor(public x: number, public y: number) {}
    }

    const serializer = new RPCJsonSerializer({
      handlers: {
        point: {
          condition: (value: unknown) => value instanceof Point,
          serialize: (value: Point) => [value.x, value.y],
          deserialize: ([x, y]: [number, number]) => new Point(x, y),
          isTerminal: true,
        },
      },
    })

    const key = generateOperationKey(['ping'], { serializer, input: { at: new Point(1, 2) } })

    expect(deserializeOperationKeyInput(key, serializer)).toEqual({ at: new Point(1, 2) })
  })
})
