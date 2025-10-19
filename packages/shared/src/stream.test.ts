import { AsyncIteratorClass } from './iterator'
import { asyncIteratorToStream, asyncIteratorToUnproxiedDataStream, streamToAsyncIteratorClass } from './stream'

describe('streamToAsyncIteratorClass', () => {
  it('should convert a ReadableStream to AsyncIteratorClass', async () => {
    const values = [1, 2, 3, 4, 5]
    const stream = new ReadableStream<number>({
      start(controller) {
        values.forEach(value => controller.enqueue(value))
        controller.close()
      },
    })

    const iterator = streamToAsyncIteratorClass(stream)
    expect(iterator).toBeInstanceOf(AsyncIteratorClass)

    const results: number[] = []
    for await (const value of iterator) {
      results.push(value)
    }

    expect(results).toEqual(values)
  })

  it('should handle empty stream', async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.close()
      },
    })

    const iterator = streamToAsyncIteratorClass(stream)
    const results: number[] = []

    for await (const value of iterator) {
      results.push(value)
    }

    expect(results).toEqual([])
  })

  it('should handle stream errors', async () => {
    const error = new Error('Stream error')
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.error(error)
      },
    })

    const iterator = streamToAsyncIteratorClass(stream)

    try {
      for await (const value of iterator) {
        // Should not reach here
      }
      expect.fail('Should have thrown an error')
    }
    catch (err) {
      expect(err).toBe(error)
    }
  })

  it('should properly cleanup when iterator is returned early', async () => {
    let cleanupCalled = false
    const stream = new ReadableStream<number>({
      start(controller) {
        for (let i = 1; i <= 10; i++) {
          controller.enqueue(i)
        }
        controller.close()
      },
      cancel() {
        cleanupCalled = true
      },
    })

    const iterator = streamToAsyncIteratorClass(stream)

    await iterator.next()
    await iterator.return()

    expect(cleanupCalled).toBe(true)
  })
})

describe('asyncIteratorToStream', () => {
  it('should convert an AsyncIterator to ReadableStream', async () => {
    async function* generator() {
      yield 1
      yield 2
      yield 3
    }

    const asyncIterator = generator()
    const stream = asyncIteratorToStream(asyncIterator)

    expect(stream).toBeInstanceOf(ReadableStream)

    const reader = stream.getReader()
    const results: number[] = []

    let result = await reader.read()
    while (!result.done) {
      results.push(result.value)
      result = await reader.read()
    }

    expect(results).toEqual([1, 2, 3])
  })

  it('should handle empty async iterator', async () => {
    async function* emptyGenerator() {
      // Empty generator
    }

    const asyncIterator = emptyGenerator()
    const stream = asyncIteratorToStream(asyncIterator)

    const reader = stream.getReader()
    const result = await reader.read()

    expect(result.done).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('should handle async iterator errors', async () => {
    const error = new Error('Iterator error')
    async function* errorGenerator() {
      yield 1
      throw error
    }

    const asyncIterator = errorGenerator()
    const stream = asyncIteratorToStream(asyncIterator)

    const reader = stream.getReader()

    // First read should succeed
    const firstResult = await reader.read()
    expect(firstResult.done).toBe(false)
    expect(firstResult.value).toBe(1)

    // Second read should throw the error
    await expect(reader.read()).rejects.toThrow(error)
  })

  it('should call iterator.return when stream is cancelled', async () => {
    let cleanupCalled = false

    const stream = asyncIteratorToStream(async function* () {
      try {
        yield 1
        yield 2
        await new Promise(resolve => setTimeout(resolve, 100)) // Simulate async operation
      }
      finally {
        cleanupCalled = true
      }
    }())

    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(cleanupCalled).toBe(true)
  })
})

it('streamToAsyncIteratorClass + asyncIteratorToStream', async () => {
  const stream = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1)
      controller.enqueue(2)
      controller.enqueue(3)
      controller.close()
    },
  })

  const iterator = streamToAsyncIteratorClass(stream)
  const newStream = asyncIteratorToStream(iterator)
  const newIterator = streamToAsyncIteratorClass(newStream)

  const results: number[] = []
  for await (const value of newIterator) {
    results.push(value)
  }

  expect(results).toEqual([1, 2, 3])
})

describe('asyncIteratorToUnproxiedDataStream', () => {
  const PROXY_SYMBOL = Symbol('proxy')

  function proxy(value: object) {
    return new Proxy(value, {
      get(target, prop) {
        if (prop === PROXY_SYMBOL) {
          return true
        }

        return Reflect.get(target, prop)
      },
    })
  }

  function isProxied(value: any) {
    return Boolean(typeof value === 'object' && value && value[PROXY_SYMBOL])
  }

  it('should convert an AsyncIterator to ReadableStream and unproxied data', async () => {
    const date = new Date()
    const set = new Set([date])

    async function* generator() {
      yield 1
      yield proxy({ order: 2 })
      yield { order: 3 }
      yield [4]
      yield proxy([5])
      yield date // support native Date
      yield set // support native Set
    }

    const asyncIterator = generator()
    const stream = asyncIteratorToUnproxiedDataStream(asyncIterator)

    expect(stream).toBeInstanceOf(ReadableStream)

    const reader = stream.getReader()
    const results: any[] = []

    let result = await reader.read()
    while (!result.done) {
      results.push(result.value)
      result = await reader.read()
    }

    expect(results).toEqual([
      1,
      { order: 2 },
      { order: 3 },
      [4],
      [5],
      date,
      set,
    ])

    expect(results.some(isProxied)).toBe(false)
  })

  it('should handle empty async iterator', async () => {
    async function* emptyGenerator() {
      // Empty generator
    }

    const asyncIterator = emptyGenerator()
    const stream = asyncIteratorToUnproxiedDataStream(asyncIterator)

    const reader = stream.getReader()
    const result = await reader.read()

    expect(result.done).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('should handle async iterator errors', async () => {
    const error = new Error('Iterator error')
    async function* errorGenerator() {
      yield 1
      throw error
    }

    const asyncIterator = errorGenerator()
    const stream = asyncIteratorToUnproxiedDataStream(asyncIterator)

    const reader = stream.getReader()

    // First read should succeed
    const firstResult = await reader.read()
    expect(firstResult.done).toBe(false)
    expect(firstResult.value).toBe(1)

    // Second read should throw the error
    await expect(reader.read()).rejects.toThrow(error)
  })

  it('should call iterator.return when stream is cancelled', async () => {
    let cleanupCalled = false

    const stream = asyncIteratorToUnproxiedDataStream(async function* () {
      try {
        yield 1
        yield 2
        await new Promise(resolve => setTimeout(resolve, 100)) // Simulate async operation
      }
      finally {
        cleanupCalled = true
      }
    }())

    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(cleanupCalled).toBe(true)
  })
})
