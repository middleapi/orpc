import { sleep } from '@standard-server/shared'

import { promiseWithResolvers } from './promise.ts'
import {
  pipeStreamToCache,
  runWithOwnSignal,
  streamedArrayKeyOptions,
  streamedArrayWrites,
} from './stream-to-cache.ts'

function createStore(initial?: number[]) {
  const store = {
    value: initial,
    writes: [] as (number[] | undefined)[],
    update: (updater: (current: number[] | undefined) => number[]): number[] => {
      store.value = updater(store.value)
      store.writes.push(store.value)
      return store.value
    },
  }
  return store
}

const append = (current: number[] | undefined, chunk: number): number[] => [
  ...(current ?? []),
  chunk,
]

describe('pipeStreamToCache', () => {
  it('writes once at connect, before the first next(), then once per chunk', async () => {
    const log: string[] = []
    const store = createStore([0])

    async function* gen() {
      log.push('start')
      yield 1
      yield 2
    }

    const onConnect = vi.fn((current: number[] | undefined) => {
      log.push('connect')
      return current ?? []
    })

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onConnect,
        onChunk: append,
      }),
    ).resolves.toEqual({ data: [0, 1, 2] })

    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onConnect).toHaveBeenCalledWith([0])
    expect(log).toEqual(['connect', 'start'])
    expect(store.writes).toEqual([[0], [0, 1], [0, 1, 2]])
  })

  it('writes nothing before the first chunk without onConnect', async () => {
    const store = createStore([0])
    const gate = promiseWithResolvers<void>()

    async function* gen() {
      await gate.promise
      yield 1
    }

    const promise = pipeStreamToCache(gen(), {
      signal: new AbortController().signal,
      update: store.update,
      onChunk: append,
    })

    await sleep(10)
    expect(store.writes).toEqual([])

    gate.resolve()
    await expect(promise).resolves.toEqual({ data: [0, 1] })
    expect(store.writes).toEqual([[0, 1]])
  })

  it('resolves with undefined when nothing was written', async () => {
    const store = createStore([0])

    async function* gen(): AsyncGenerator<number> {}

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onChunk: append,
      }),
    ).resolves.toBeUndefined()

    expect(store.value).toEqual([0])
  })

  it('reads the cache live, so external writes between chunks are kept', async () => {
    const store = createStore()

    async function* gen() {
      yield 1
      store.value = [...store.value!, 99]
      yield 2
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onConnect: () => [],
        onChunk: append,
      }),
    ).resolves.toEqual({ data: [1, 99, 2] })
  })

  it('closes the stream without starting it when aborted before the call', async () => {
    const store = createStore([0])
    const controller = new AbortController()
    const reason = new Error('aborted')
    controller.abort(reason)

    let started = false
    async function* gen() {
      started = true
      yield 1
    }
    const stream = gen()
    const returnSpy = vi.spyOn(stream, 'return')
    const onConnect = vi.fn(() => [])

    await expect(
      pipeStreamToCache(stream, {
        signal: controller.signal,
        update: store.update,
        onConnect,
        onChunk: append,
      }),
    ).rejects.toBe(reason)

    expect(returnSpy).toHaveBeenCalledTimes(1)
    expect(started).toBe(false)
    expect(onConnect).not.toHaveBeenCalled()
    expect(store.writes).toEqual([])
    expect(store.value).toEqual([0])
  })

  it('closes the stream and rethrows when onConnect throws', async () => {
    const error = new Error('connect error')
    async function* gen() {
      yield 1
    }
    const stream = gen()
    const returnSpy = vi.spyOn(stream, 'return')

    await expect(
      pipeStreamToCache(stream, {
        signal: new AbortController().signal,
        update: createStore().update,
        onConnect: () => {
          throw error
        },
        onChunk: append,
      }),
    ).rejects.toBe(error)

    expect(returnSpy).toHaveBeenCalledTimes(1)
  })

  it('stops writing and closes the stream when aborted while awaiting next()', async () => {
    const store = createStore()
    const controller = new AbortController()
    const reason = new Error('aborted')
    const gate = promiseWithResolvers<void>()
    const cleanup = vi.fn()

    async function* gen() {
      try {
        yield 1
        await gate.promise
        yield 2
        yield 3
      } finally {
        cleanup()
      }
    }

    const promise = pipeStreamToCache(gen(), {
      signal: controller.signal,
      update: store.update,
      onChunk: append,
    })

    await vi.waitFor(() => expect(store.writes).toEqual([[1]]))
    controller.abort(reason)
    gate.resolve()

    await expect(promise).rejects.toBe(reason)
    expect(store.writes).toEqual([[1]])
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('stops at once when update aborts the signal', async () => {
    const store = createStore()
    const controller = new AbortController()
    const reason = new Error('aborted')
    const afterFirst = vi.fn()
    const cleanup = vi.fn()

    async function* gen() {
      try {
        yield 1
        afterFirst()
        yield 2
      } finally {
        cleanup()
      }
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: controller.signal,
        update: (updater) => {
          const data = store.update(updater)
          controller.abort(reason)
          return data
        },
        onChunk: append,
      }),
    ).rejects.toBe(reason)

    expect(afterFirst).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(store.writes).toEqual([[1]])
  })

  it('settles at the first chunk without waiting for the next one', async () => {
    const store = createStore()
    const cleanup = vi.fn()

    async function* gen() {
      try {
        yield 1
        await new Promise(() => {})
        yield 2
      } finally {
        cleanup()
      }
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onChunk: append,
        settle: () => true,
      }),
    ).resolves.toEqual({ data: [1] })

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(store.writes).toEqual([[1]])
  })

  it('settles at connect without starting the stream', async () => {
    const store = createStore([0])
    let started = false

    async function* gen() {
      started = true
      yield 1
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onConnect: () => [],
        onChunk: append,
        settle: () => true,
      }),
    ).resolves.toEqual({ data: [] })

    expect(started).toBe(false)
    expect(store.writes).toEqual([[]])
  })

  it('rejects and keeps the first write when settle aborts the signal', async () => {
    const store = createStore()
    const controller = new AbortController()
    const reason = new Error('aborted')
    const cleanup = vi.fn()

    async function* gen() {
      try {
        yield 1
        yield 2
      } finally {
        cleanup()
      }
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: controller.signal,
        update: store.update,
        onChunk: append,
        settle: () => {
          controller.abort(reason)
          return false
        },
      }),
    ).rejects.toBe(reason)

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(store.value).toEqual([1])
  })

  it('calls settle once and follows the stream to its end when it returns false', async () => {
    const store = createStore()
    const settle = vi.fn(() => false)

    async function* gen() {
      yield 1
      yield 2
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onConnect: () => [],
        onChunk: append,
        settle,
      }),
    ).resolves.toEqual({ data: [1, 2] })

    expect(settle).toHaveBeenCalledTimes(1)
    expect(store.writes).toEqual([[], [1], [1, 2]])
  })

  it('rejects on a stream error before the first write and keeps existing data', async () => {
    const store = createStore([0])
    const error = new Error('stream error')

    async function* gen(): AsyncGenerator<number> {
      throw error
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onChunk: append,
      }),
    ).rejects.toBe(error)

    expect(store.writes).toEqual([])
    expect(store.value).toEqual([0])
  })

  it('rejects on a stream error after the first write and keeps the written data', async () => {
    const store = createStore()
    const error = new Error('stream error')

    async function* gen() {
      yield 1
      throw error
    }

    await expect(
      pipeStreamToCache(gen(), {
        signal: new AbortController().signal,
        update: store.update,
        onConnect: () => [],
        onChunk: append,
      }),
    ).rejects.toBe(error)

    expect(store.value).toEqual([1])
  })

  it('ignores a stream that fails to close', async () => {
    const store = createStore()
    const stream = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 1 }),
        return: async () => {
          throw new Error('close error')
        },
      }),
    }

    await expect(
      pipeStreamToCache(stream, {
        signal: new AbortController().signal,
        update: store.update,
        onChunk: append,
        settle: () => true,
      }),
    ).resolves.toEqual({ data: [1] })
  })

  it('rejects with the abort reason over a stream error', async () => {
    const controller = new AbortController()
    const reason = new Error('aborted')
    const stream = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          controller.abort(reason)
          throw new Error('stream error')
        },
      }),
    }

    await expect(
      pipeStreamToCache(stream, {
        signal: controller.signal,
        update: createStore().update,
        onChunk: append,
      }),
    ).rejects.toBe(reason)
  })
})

describe('runWithOwnSignal', () => {
  it('aborts its own signal once fn ends', async () => {
    const parent = new AbortController()
    let signal: AbortSignal | undefined

    await expect(
      runWithOwnSignal(parent.signal, async (s) => {
        signal = s
        expect(s.aborted).toBe(false)
        return 1
      }),
    ).resolves.toBe(1)

    expect(signal!.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  it('follows the parent signal', async () => {
    const parent = new AbortController()
    const reason = new Error('aborted')

    await runWithOwnSignal(parent.signal, async (signal) => {
      parent.abort(reason)
      expect(signal.reason).toBe(reason)
    })

    const aborted = AbortSignal.abort(reason)
    await runWithOwnSignal(aborted, async (signal) => expect(signal.reason).toBe(reason))
  })
})

describe('streamedArrayWrites', () => {
  it.each([
    ['reset', undefined, [], [1]],
    ['reset', [7, 8, 9], [], [1]],
    ['append', undefined, [], [1]],
    ['append', [7, 8, 9], [8, 9], [9, 1]],
  ] as const)('%s over %j', (refetchMode, existing, connected, afterChunk) => {
    const { onConnect, onChunk } = streamedArrayWrites<number>({ refetchMode, maxChunks: 2 })

    expect(onConnect(existing && [...existing])).toEqual(connected)
    expect(onChunk(onConnect(existing && [...existing]), 1)).toEqual(afterChunk)
  })

  it('defaults to reset with unlimited chunks', () => {
    const { onConnect, onChunk } = streamedArrayWrites<number>()

    expect(onConnect([1, 2])).toEqual([])
    expect(onChunk([1, 2, 3], 4)).toEqual([1, 2, 3, 4])
  })
})

it('streamedArrayKeyOptions keeps only non-default options', () => {
  expect(streamedArrayKeyOptions({ refetchMode: 'append', maxChunks: 3 })).toEqual({
    refetchMode: 'append',
    maxChunks: 3,
  })
  expect(streamedArrayKeyOptions({ refetchMode: 'append' })).toEqual({ refetchMode: 'append' })
  expect(streamedArrayKeyOptions({ refetchMode: 'reset', maxChunks: 3 })).toEqual({ maxChunks: 3 })
  expect(
    streamedArrayKeyOptions({ refetchMode: 'reset', maxChunks: Number.POSITIVE_INFINITY }),
  ).toBeUndefined()
  expect(streamedArrayKeyOptions({})).toBeUndefined()
  expect(streamedArrayKeyOptions(undefined)).toBeUndefined()
})
