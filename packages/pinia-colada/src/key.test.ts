import { RPCJsonSerializer } from '@orpc/client'
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
  expect(generateOperationKey(['path', 'path2'], { input: { a: date } })).toEqual([['path', 'path2'], { input: { a: date.toISOString() } }])

  expect(generateOperationKey(['path'], { prefix: '__prefix__' })).toEqual(['__prefix__', ['path'], {}])
  expect(generateOperationKey(['path'], { prefix: undefined })).toEqual([['path'], {}])
  expect(generateOperationKey(['path'], { prefix: '__prefix__', type: 'query', input: { a: 1 } })).toEqual(['__prefix__', ['path'], { type: 'query', input: { a: 1 } }])
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
})
