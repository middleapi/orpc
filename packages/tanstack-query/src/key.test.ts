import { RPCJsonSerializer } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { hashKey, partialMatchKey, QueryClient, skipToken } from '@tanstack/query-core'
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

  expect(generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any }))
    .toEqual([['planet', 'list'], { type: 'query', skipToken: true }])
})

describe('generateOperationKey with skipToken', () => {
  it('does not collide with the no-input key when hashed', () => {
    expect(hashKey(generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any })))
      .not
      .toEqual(hashKey(generateOperationKey(['planet', 'list'], { type: 'query' })))
  })

  it('still partially matches keys without input', () => {
    const skipped = generateOperationKey(['planet', 'list'], { type: 'query', input: skipToken as any })

    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list']))).toBe(true)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { type: 'query' }))).toBe(true)
    expect(partialMatchKey(skipped, generateOperationKey(['planet', 'list'], { input: {} }))).toBe(false)
  })
})

describe('generateOperationKey input meta', () => {
  it('keys meta by JSON-encoded path', () => {
    expect(generateOperationKey(['path'], { input: { a: { 'b.c': [1n, new Set([new URL('https://orpc.dev')])] } } })).toEqual([['path'], {
      input: { a: { 'b.c': ['1', ['https://orpc.dev/']] } },
      inputMeta: {
        '["a","b.c",0]': ['bigint'],
        '["a","b.c",1,0]': ['url'],
        '["a","b.c",1]': ['set'],
      },
    }])

    expect(generateOperationKey(['path'], { input: new Date(0) })).toEqual([['path'], {
      input: '1970-01-01T00:00:00.000Z',
      inputMeta: { '[]': ['date'] },
    }])
  })

  it('distinguishes inputs with the same JSON form', () => {
    const date = new Date(0)

    expect(hashKey(generateOperationKey(['path'], { input: { a: date } })))
      .not
      .toEqual(hashKey(generateOperationKey(['path'], { input: { a: date.toISOString() } })))

    expect(hashKey(generateOperationKey(['path'], { input: 1n })))
      .not
      .toEqual(hashKey(generateOperationKey(['path'], { input: '1' })))
  })

  it('hashes Set and Map inputs by their content', () => {
    expect(hashKey(generateOperationKey(['path'], { input: new Set(['a']) })))
      .not
      .toEqual(hashKey(generateOperationKey(['path'], { input: new Set(['b']) })))

    expect(hashKey(generateOperationKey(['path'], { input: new Map([['a', 1]]) })))
      .not
      .toEqual(hashKey(generateOperationKey(['path'], { input: new Map([['a', 2]]) })))
  })

  it('keeps every type of a value serialized by chained handlers', () => {
    const serializer = new RPCJsonSerializer({
      handlers: {
        timestamp: {
          condition: value => typeof value === 'object' && value !== null && 'timestamp' in value,
          serialize: (value: { timestamp: number }) => new Date(value.timestamp),
          deserialize: (value: Date) => ({ timestamp: value.getTime() }),
        },
      },
    })

    expect(generateOperationKey(['path'], { serializer, input: { a: { timestamp: 0 } } })).toEqual([['path'], {
      input: { a: '1970-01-01T00:00:00.000Z' },
      inputMeta: { '["a"]': ['date', 'timestamp'] },
    }])
  })

  it('partially matches queries by value', async () => {
    const queryClient = new QueryClient()
    const from = new Date(0)
    const to = new Date(1)

    queryClient.setQueryData(generateOperationKey(['list'], { type: 'query', input: { from, to } }), 'date')
    queryClient.setQueryData(generateOperationKey(['list'], { type: 'query', input: { from: from.toISOString(), to } }), 'string')
    queryClient.setQueryData(generateOperationKey(['list'], { type: 'query', input: { from: new Date(2), to } }), 'other date')

    const data = (input: unknown) => queryClient.getQueriesData({ queryKey: generateOperationKey(['list'], { input }) }).map(([, data]) => data)

    expect(queryClient.getQueryCache().getAll()).toHaveLength(3)
    expect(data({ to })).toEqual(['date', 'string', 'other date'])
    expect(data({ from })).toEqual(['date'])

    await queryClient.invalidateQueries({ queryKey: generateOperationKey(['list'], { input: { from } }) })
    expect(queryClient.getQueryCache().getAll().filter(query => query.state.isInvalidated).map(query => query.state.data)).toEqual(['date'])
  })
})

describe('generateOperationKey serializer', () => {
  class Point {
    constructor(public x: number, public y: number) {}
  }

  const serializer = new RPCJsonSerializer({
    handlers: {
      point: {
        condition: value => value instanceof Point,
        serialize: (value: Point) => [value.x, value.y],
        deserialize: ([x, y]: [number, number]) => new Point(x, y),
        isTerminal: true,
      },
    },
  })

  it('serializes input with the given serializer', () => {
    expect(generateOperationKey(['path'], { serializer, input: { p: new Point(1, 2) } })).toEqual([['path'], {
      input: { p: [1, 2] },
      inputMeta: { '["p"]': ['point'] },
    }])

    expect(generateOperationKey(['path'], { input: { p: new Point(1, 2) } })).toEqual([['path'], {
      input: { p: new Point(1, 2) },
    }])
  })

  it('accepts an OpenAPI serializer, whose keys carry no type info', () => {
    expect(generateOperationKey(['path'], { serializer: new OpenAPIJsonSerializer(), input: { a: new Date(0) } })).toEqual([['path'], {
      input: { a: '1970-01-01T00:00:00.000Z' },
    }])
  })

  it('skips the serializer when input is undefined or skipToken', () => {
    const serializeJson = vi.fn()
    const serializer = { serializeJson, deserializeJson: vi.fn() }

    expect(generateOperationKey(['path'], { serializer, type: 'query' })).toEqual([['path'], { type: 'query' }])
    expect(generateOperationKey(['path'], { serializer, input: skipToken as any })).toEqual([['path'], { skipToken: true }])
    expect(serializeJson).not.toHaveBeenCalled()
  })

  it('omits empty meta', () => {
    const serializeJson = vi.fn(() => ({ json: { a: 1 }, meta: [] }))

    expect(generateOperationKey(['path'], { serializer: { serializeJson, deserializeJson: vi.fn() }, input: { a: 1 } })).toEqual([['path'], { input: { a: 1 } }])
    expect(serializeJson).toHaveBeenCalledWith({ a: 1 })
  })
})
