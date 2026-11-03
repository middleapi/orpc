import { unstable_serialize } from 'swr'
import { builtInRPCSupportDataTypes } from '../../../tests/rpc/__shared__/built-in-support-data-types'
import { Point, pointSerializer } from '../tests/__shared__/serializer'
import { deserializeOperationKeyInput, generateOperationKey } from './key'

const hash = (input: unknown) => unstable_serialize(generateOperationKey(['ping'], { input }))

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

  it('produces SWR cache keys that compare Set, Map, BigInt and Date inputs by value', () => {
    const create = () => ({ ids: new Set([1, 2]), map: new Map([['a', 1]]), big: 1n, since: new Date('2024-01-01') })

    expect(hash(create())).toBe(hash(create()))
    expect(hash({ ...create(), ids: new Set([2, 1]) })).not.toBe(hash(create()))
    expect(hash({ ...create(), map: new Map([['a', 2]]) })).not.toBe(hash(create()))
    expect(hash({ ...create(), big: 2n })).not.toBe(hash(create()))
    expect(hash({ ...create(), since: new Date('2024-01-02') })).not.toBe(hash(create()))
  })

  it('distinguishes values that share a JSON form', () => {
    expect(hash({ a: 1n })).not.toBe(hash({ a: 1 }))
    expect(hash({ a: 1n })).not.toBe(hash({ a: '1' }))
    expect(hash({ a: new Date('2024-01-01') })).not.toBe(hash({ a: '2024-01-01T00:00:00.000Z' }))
    expect(hash({ a: new Set([1]) })).not.toBe(hash({ a: [1] }))
    expect(hash({ a: new Map([[1, 2]]) })).not.toBe(hash({ a: [[1, 2]] }))
  })

  it('uses a custom serializer', () => {
    const key = generateOperationKey(['ping'], { serializer: pointSerializer, input: { at: new Point(1, 2) } })

    expect(key).toEqual([['ping'], { input: { at: [1, 2] }, inputMeta: { '["at"]': ['point'] } }])
    expect(deserializeOperationKeyInput(key, pointSerializer)).toEqual({ at: new Point(1, 2) })
  })
})

describe('deserializeOperationKeyInput', () => {
  it('returns undefined when the key has no input', () => {
    expect(deserializeOperationKeyInput(generateOperationKey(['ping']))).toBeUndefined()
    expect(deserializeOperationKeyInput(generateOperationKey(['ping'], { prefix: '__prefix__' }))).toBeUndefined()
  })

  it.each(
    builtInRPCSupportDataTypes.filter(({ value }) => !(value instanceof Blob)),
  )('restores $name', ({ value, expected }) => {
    expect(deserializeOperationKeyInput(generateOperationKey(['ping'], { input: { value } }))).toEqual({ value: expected })
  })

  it('restores nested types without mutating the key', () => {
    const input = {
      ids: new Set([new Date('2024-01-01'), new Date('2024-01-02')]),
      map: new Map<unknown, unknown>([[new Date('2024-01-03'), new Set([1n])], ['b', undefined]]),
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

    expect(deserializeOperationKeyInput([path, { ...content, inputMeta: reversed }])).toEqual(input)
  })
})
