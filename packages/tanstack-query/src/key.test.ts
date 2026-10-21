import type { QueryKey } from '@tanstack/query-core'
import { RPCJsonSerializer } from '@orpc/client'
import { hashKey, partialMatchKey, skipToken } from '@tanstack/query-core'
import { createQueryKeyHashFn, generateOperationKey } from './key'

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

  expect(generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any }))
    .toEqual([['planet', 'list'], { type: 'query', skipToken: true }])
})

describe('generateOperationKey with skipToken', () => {
  const hashers: [name: string, hash: (queryKey: QueryKey) => string][] = [
    ['hashKey', hashKey],
    ['createQueryKeyHashFn', createQueryKeyHashFn()],
  ]

  it.each(hashers)('does not collide with the no-input key when hashed with %s', (_, hash) => {
    expect(hash(generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any })))
      .not
      .toEqual(hash(generateOperationKey(['planet', 'list'], { type: 'query' })))
  })

  it('still partially matches keys without input', () => {
    const skipped = generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any })

    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list']))).toBe(true)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { type: 'query' }))).toBe(true)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { input: {} }))).toBe(false)
  })
})

describe('createQueryKeyHashFn', () => {
  const hash = createQueryKeyHashFn()

  it('hashes keys hashKey cannot handle', () => {
    expect(() => hashKey([{ input: 1n }])).toThrow()
    expect(hash([{ input: 1n }])).toEqual(expect.any(String))
  })

  it('distinguishes oRPC types from their JSON representation', () => {
    const date = new Date('2024-01-01')

    expect(hashKey([{ input: date }])).toEqual(hashKey([{ input: date.toISOString() }]))
    expect(hash([{ input: date }])).not.toEqual(hash([{ input: date.toISOString() }]))
    expect(hash([{ input: 1n }])).not.toEqual(hash([{ input: '1' }]))
    expect(hash([{ input: new Set([1]) }])).not.toEqual(hash([{ input: [1] }]))
  })

  it('ignores object key order', () => {
    expect(hash([{ a: 1n, b: new Date(0) }])).toEqual(hash([{ b: new Date(0), a: 1n }]))
    expect(hash([{ a: 1n, b: new Date(0) }])).not.toEqual(hash([{ a: new Date(0), b: 1n }]))
  })

  it('uses the given serializer', () => {
    class Person {
      constructor(public name: string) {}
    }

    const hash = createQueryKeyHashFn(new RPCJsonSerializer({
      handlers: {
        person: {
          condition: value => value instanceof Person,
          serialize: (value: Person) => value.name,
          deserialize: name => new Person(name as string),
        },
      },
    }))

    expect(hash([{ input: new Person('Earth') }])).not.toEqual(hash([{ input: new Person('Mars') }]))
    expect(hash([{ input: new Person('Earth') }])).not.toEqual(hash([{ input: 'Earth' }]))
  })
})
