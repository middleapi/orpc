import { RPCJsonSerializer } from '@orpc/client'
import { useQueryCache } from '@pinia/colada'
import { createPinia } from 'pinia'
import { generateOperationKey } from './key'

it('generateOperationKey', () => {
  expect(generateOperationKey(['path'])).toEqual([['path'], {}])
  expect(generateOperationKey(['path', 'path2'], { input: { a: 1 } })).toEqual([['path', 'path2'], { input: { a: 1 } }])
  expect(generateOperationKey(['path'], { input: undefined })).toEqual([['path'], {}])
  expect(generateOperationKey(['path', 'path2'], { type: 'query' })).toEqual([['path', 'path2'], { type: 'query' }])
  expect(generateOperationKey(['path'], { type: undefined })).toEqual([['path'], {}])
  expect(generateOperationKey(['path', 'path2'], { type: 'query', input: { a: 1 } })).toEqual([['path', 'path2'], { type: 'query', input: { a: 1 } }])
  expect(generateOperationKey(['path'], { type: 'mutation' })).toEqual([['path'], { type: 'mutation' }])

  const date = new Date()
  expect(generateOperationKey(['path', 'path2'], { input: { a: date } })).toEqual([['path', 'path2'], { input: { a: date.toISOString() }, inputMeta: { '["a"]': ['date'] } }])

  expect(generateOperationKey(['path'], { prefix: '__prefix__' })).toEqual(['__prefix__', ['path'], {}])
  expect(generateOperationKey(['path'], { prefix: undefined })).toEqual([['path'], {}])
  expect(generateOperationKey(['path'], { prefix: '__prefix__', type: 'query', input: { a: 1 } })).toEqual(['__prefix__', ['path'], { type: 'query', input: { a: 1 } }])
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

    expect(generateOperationKey(['path'], { input: { a: date } }))
      .not
      .toEqual(generateOperationKey(['path'], { input: { a: date.toISOString() } }))
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

  it('still partially matches entries in the query cache', () => {
    const queryCache = useQueryCache(createPinia())
    const from = new Date(0)
    const to = new Date(1)

    queryCache.setQueryData(generateOperationKey(['list'], { type: 'query', input: { from, to } }), 'date')
    queryCache.setQueryData(generateOperationKey(['list'], { type: 'query', input: { from: from.toISOString(), to } }), 'string')

    expect(queryCache.getEntries().length).toBe(2)
    expect(queryCache.getEntries({ key: generateOperationKey(['list'], { input: { to } }) }).map(e => e.state.value.data)).toEqual(['date', 'string'])
    expect(queryCache.getEntries({ key: generateOperationKey(['list'], { input: { from } }) }).map(e => e.state.value.data)).toEqual(['date'])
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

  it('skips the serializer when input is undefined', () => {
    const serializeJson = vi.fn()

    expect(generateOperationKey(['path'], { serializer: { serializeJson, deserializeJson: vi.fn() }, type: 'query' })).toEqual([['path'], { type: 'query' }])
    expect(serializeJson).not.toHaveBeenCalled()
  })

  it('omits empty meta', () => {
    const serializeJson = vi.fn(() => ({ json: { a: 1 }, meta: [] }))

    expect(generateOperationKey(['path'], { serializer: { serializeJson, deserializeJson: vi.fn() }, input: { a: 1 } })).toEqual([['path'], { input: { a: 1 } }])
    expect(serializeJson).toHaveBeenCalledWith({ a: 1 })
  })
})
