import type { QueryKey } from '@tanstack/query-core'
import { RPCJsonSerializer } from '@orpc/client'
import { hashKey, partialMatchKey, skipToken } from '@tanstack/query-core'
import { generateOperationKey } from './key'

it('generateOperationKey', () => {
  expect(generateOperationKey(['path'])).toEqual([['path'], {}])
  expect(generateOperationKey(['planet', 'create'], { type: 'mutation' }))
    .toEqual([['planet', 'create'], { type: 'mutation' }])
  expect(generateOperationKey(['planet', 'find'], { type: 'query', input: { id: 1 } }))
    .toEqual([['planet', 'find'], { type: 'query', input: { id: 1 } }])
  expect(generateOperationKey(['planet', 'stream'], { type: 'streamed', input: { cursor: 0 }, fnOptions: { refetchMode: 'append' } }))
    .toEqual([['planet', 'stream'], { type: 'streamed', input: { cursor: 0 }, fnOptions: { refetchMode: 'append' } }])

  expect(generateOperationKey(['path'], { prefix: '__prefix__' })).toEqual(['__prefix__', ['path'], {}])
  expect(generateOperationKey(['path'], { prefix: undefined })).toEqual([['path'], {}])
  expect(generateOperationKey(['path'], { prefix: '__prefix__', type: 'query', input: { a: 1 } })).toEqual(['__prefix__', ['path'], { type: 'query', input: { a: 1 } }])
})

describe('generateOperationKey with skipToken', () => {
  const serializer = new RPCJsonSerializer()

  const hashers: [name: string, hash: (queryKey: QueryKey) => string][] = [
    ['hashKey', hashKey],
    ['RPCJsonSerializer', (queryKey) => {
      const { json, meta } = serializer.serialize(queryKey)

      return hashKey([
        json,
        meta?.map(entry => JSON.stringify(entry)).sort(),
      ])
    }],
  ]

  it('replaces the symbol with a serializable marker', () => {
    expect(generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any }))
      .toEqual([['planet', 'list'], { type: 'query', skipToken: true }])
    expect(generateOperationKey(['planet', 'list'], { prefix: '__prefix__', type: 'streamed', input: skipToken as any, fnOptions: { refetchMode: 'append' } }))
      .toEqual(['__prefix__', ['planet', 'list'], { type: 'streamed', skipToken: true, fnOptions: { refetchMode: 'append' } }])
  })

  it.each(hashers)('does not collide with unskipped keys when hashed with %s', (_, hash) => {
    for (const type of ['query', 'streamed', 'live', 'infinite'] as const) {
      const skipped = hash(generateOperationKey(['planet', 'list'], { type, input: skipToken as any }))

      expect(skipped).not.toEqual(hash(generateOperationKey(['planet', 'list'], { type })))
      expect(skipped).not.toEqual(hash(generateOperationKey(['planet', 'list'], { type, input: {} })))
      expect(skipped).not.toEqual(hash(generateOperationKey(['planet', 'list'], { type, input: { search: 'earth' } })))
    }
  })

  it('still partially matches keys without input', () => {
    const skipped = generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any })

    expect(partialMatchKey(skipped, generateOperationKey(['planet']))).toBe(true)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list']))).toBe(true)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { type: 'query' }))).toBe(true)

    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { type: 'infinite' }))).toBe(false)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { input: {} }))).toBe(false)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { input: { search: 'earth' } }))).toBe(false)
  })
})
