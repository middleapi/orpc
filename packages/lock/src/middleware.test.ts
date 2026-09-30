import type { Locker } from './types'
import { call, ORPCError, os, type } from '@orpc/server'
import { promiseWithResolvers, sleep } from '@orpc/shared'
import { MemoryLocker } from './adapters/memory'
import { LockTimeoutError } from './error'
import { lock, LOCK_MIDDLEWARE_CONTEXT_SYMBOL } from './middleware'

describe('lock', () => {
  const createLocker = (waited = false): Locker => ({
    lock: vi.fn(async (_key, fn) => fn({ waited })),
  })

  it('runs the handler under the lock', async () => {
    const locker = createLocker()
    const mw = lock({ locker, key: 'key' })
    const procedure = os.use(mw).handler(({ context }) => context['lock/waited'])

    await expect(
      call(procedure, undefined, { context: {} }),
    ).resolves.toBe(false)

    expect(locker.lock).toHaveBeenCalledTimes(1)
    expect(locker.lock).toHaveBeenCalledWith('key', expect.any(Function), { ttl: undefined, timeout: undefined, signal: undefined })
  })

  it('exposes whether the lock was waited for', async () => {
    const locker = createLocker(true)
    const procedure = os.use(lock({ locker, key: 'key' })).handler(({ context }) => context['lock/waited'])

    await expect(
      call(procedure, undefined, { context: {} }),
    ).resolves.toBe(true)
  })

  it('can config ttl, timeout and forwards the signal', async () => {
    const locker = createLocker()
    const controller = new AbortController()
    const procedure = os.use(lock({ locker, key: 'key', ttl: 5000, timeout: 1000 })).handler(() => 'ok')

    await expect(
      call(procedure, undefined, { context: {}, signal: controller.signal }),
    ).resolves.toBe('ok')

    expect(locker.lock).toHaveBeenCalledWith('key', expect.any(Function), { ttl: 5000, timeout: 1000, signal: controller.signal })
  })

  it('locker, key, ttl, timeout can be async functions', async () => {
    const locker = createLocker()
    const lockerFn = vi.fn().mockResolvedValueOnce(locker)
    const keyFn = vi.fn().mockResolvedValueOnce('key')
    const ttlFn = vi.fn().mockResolvedValueOnce(5000)
    const timeoutFn = vi.fn().mockResolvedValueOnce(1000)
    const mw = lock({ locker: lockerFn, key: keyFn, ttl: ttlFn, timeout: timeoutFn })
    const procedure = os.input(type<any>()).use(mw).handler(() => 'ok')

    await expect(
      call(procedure, '__input__', { context: { __context__: true }, path: ['__path__'] }),
    ).resolves.toBe('ok')

    expect(locker.lock).toHaveBeenCalledWith('key', expect.any(Function), { ttl: 5000, timeout: 1000, signal: undefined })

    for (const fn of [lockerFn, keyFn, ttlFn, timeoutFn]) {
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ procedure, path: ['__path__'], context: { __context__: true } }),
        '__input__',
      )
    }
  })

  it('throws CONFLICT when the lock cannot be acquired in time', async () => {
    const error = new LockTimeoutError('key')
    const locker: Locker = { lock: vi.fn().mockRejectedValue(error) }
    const handler = vi.fn()
    const procedure = os.use(lock({ locker, key: 'key' })).handler(handler)

    const thrown = await call(procedure, undefined, { context: {} }).then(() => undefined, e => e)

    expect(thrown).toBeInstanceOf(ORPCError)
    expect(thrown.code).toBe('CONFLICT')
    expect(thrown.cause).toBe(error)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes through other acquisition errors', async () => {
    const error = new Error('connection lost')
    const locker: Locker = { lock: vi.fn().mockRejectedValue(error) }
    const procedure = os.use(lock({ locker, key: 'key' })).handler(() => 'ok')

    await expect(
      call(procedure, undefined, { context: {} }),
    ).rejects.toBe(error)
  })

  it('passes through errors thrown by the handler, even LockTimeoutError', async () => {
    const locker = createLocker()
    const error = new LockTimeoutError('nested')
    const procedure = os.use(lock({ locker, key: 'key' })).handler(() => {
      throw error
    })

    await expect(
      call(procedure, undefined, { context: {} }),
    ).rejects.toBe(error)
  })

  it('communicate with middleware context, and isolated', async () => {
    const locker = createLocker()
    const mw = lock({ locker, key: 'k', dedupe: false })
    const innerHandlerFn = vi.fn().mockReturnValue('in')
    const inner = os
      .use(mw)
      .handler(innerHandlerFn)
    const outer = os
      .use(mw)
      .handler(async ({ context }) => {
        return `out:${await call(inner, undefined, { context })}:${await call(inner, undefined, { context })}`
      })

    await call(outer, undefined, { context: {} })

    expect(locker.lock).toHaveBeenCalledTimes(3)
    expect(innerHandlerFn).toHaveBeenCalledTimes(2)

    const context0 = innerHandlerFn.mock.calls[0]![0].context[LOCK_MIDDLEWARE_CONTEXT_SYMBOL]
    const context1 = innerHandlerFn.mock.calls[1]![0].context[LOCK_MIDDLEWARE_CONTEXT_SYMBOL]

    expect(context0).not.toBe(context1)
    expect(context0).toEqual(context1)
    expect(context0).toEqual({
      held: [
        { locker, key: 'k', waited: false },
        { locker, key: 'k', waited: false },
      ],
    })
  })

  describe('dedupe', () => {
    it('deduplicates by default', async () => {
      const locker = createLocker(true)
      const mw = lock({ locker, key: 'k' })
      const procedure = os.use(mw).use(mw).handler(({ context }) => context['lock/waited'])

      await expect(
        call(procedure, undefined, { context: {} }),
      ).resolves.toBe(true)

      expect(locker.lock).toHaveBeenCalledTimes(1)
    })

    it('skips dedupe when disabled', async () => {
      const locker = createLocker()
      const mw = lock({ locker, key: 'k', dedupe: false })
      await call(
        os.use(mw).use(mw).handler(() => 'ok'),
        undefined,
        { context: {} },
      )
      expect(locker.lock).toHaveBeenCalledTimes(2)
    })

    it('dedupes only same locker+key', async () => {
      const l1 = createLocker()
      const l2 = createLocker()
      const procedure = os
        .use(lock({ locker: l1, key: 'k' }))
        .use(lock({ locker: l1, key: 'diff' }))
        .use(lock({ locker: l2, key: 'k' }))
        .handler(() => 'ok')

      await call(procedure, undefined, { context: {} })
      expect(l1.lock).toHaveBeenCalledTimes(2)
      expect(l2.lock).toHaveBeenCalledTimes(1)
    })

    it('dedupes in nested calls', async () => {
      const locker = createLocker(true)
      const mw = lock({ locker, key: 'k' })
      const inner = os
        .use(mw)
        .handler(({ context }) => context['lock/waited'])
      const outer = os
        .use(mw)
        .handler(async ({ context }) => call(inner, undefined, { context }))

      await expect(
        call(outer, undefined, { context: {} }),
      ).resolves.toBe(true)

      expect(locker.lock).toHaveBeenCalledTimes(1)
    })

    it('respects per-instance dedupe', async () => {
      const locker = createLocker()
      await call(
        os.use(lock({ locker, key: 'k', dedupe: true }))
          .use(lock({ locker, key: 'k', dedupe: false })).handler(() => 'ok'),
        undefined,
        { context: {} },
      )
      expect(locker.lock).toHaveBeenCalledTimes(2)
    })
  })

  describe('streaming outputs', () => {
    const isLocked = (locker: Locker, key: string) => locker.lock(key, () => false, { timeout: 0 }).catch((error) => {
      if (error instanceof LockTimeoutError) {
        return true
      }

      throw error
    })

    it('never runs async iterator outputs with the same key concurrently', async () => {
      const locker = new MemoryLocker()
      let running = 0
      let maxRunning = 0

      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* ({ context }) {
        running++
        maxRunning = Math.max(maxRunning, running)
        await sleep(20)
        yield context['lock/waited']
        await sleep(20)
        running--
      })

      const consume = async () => {
        const values: boolean[] = []

        for await (const value of await call(procedure, undefined, { context: {} })) {
          values.push(value)
        }

        return values
      }

      await expect(Promise.all([consume(), consume()])).resolves.toEqual([[false], [true]])
      expect(maxRunning).toBe(1)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('holds the lock until an async iterator output is fully consumed', async () => {
      const locker = new MemoryLocker()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        yield 1
        return 'done'
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await expect(iterator.next()).resolves.toEqual({ done: true, value: 'done' })
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock once an async iterator output is returned early, after the generator stops', async () => {
      const locker = new MemoryLocker()
      const { promise: waiting, resolve: markWaiting } = promiseWithResolvers<void>()
      const { promise: gate, resolve: openGate } = promiseWithResolvers<void>()
      const cleanup = vi.fn()

      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        try {
          yield 1
          markWaiting()
          await gate
          yield 2
        }
        finally {
          cleanup()
        }
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })

      const pending = iterator.next()
      await waiting
      const returned = iterator.return?.()

      // The generator is still running, so the lock must stay held
      await sleep(10)
      expect(cleanup).not.toHaveBeenCalled()
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      openGate()
      await returned

      expect(cleanup).toHaveBeenCalledTimes(1)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
      await expect(pending).resolves.toEqual({ done: true, value: undefined })
    })

    it('releases the lock when an async iterator output throws', async () => {
      const locker = new MemoryLocker()
      const error = new Error('boom')
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        yield 1
        throw error
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(iterator.next()).rejects.toBe(error)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock when an async iterator output stops on abort', async () => {
      const locker = new MemoryLocker()
      const controller = new AbortController()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* ({ signal }) {
        yield 1
        await sleep(10_000, { signal })
      })

      const iterator = await call(procedure, undefined, { context: {}, signal: controller.signal })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })

      const pending = iterator.next()
      controller.abort(new Error('aborted'))

      await expect(pending).rejects.toThrow('aborted')
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('surfaces release errors of an async iterator output to its consumer', async () => {
      const error = new Error('release failed')
      const locker: Locker = {
        lock: async (_key, fn) => {
          await fn({ waited: false })
          throw error
        },
      }

      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        yield 1
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(iterator.next()).rejects.toBe(error)
    })

    it('never runs ReadableStream outputs with the same key concurrently', async () => {
      const locker = new MemoryLocker()
      let running = 0
      let maxRunning = 0

      const procedure = os.use(lock({ locker, key: 'k' })).handler(() => {
        let count = 0

        return new ReadableStream<number>({
          async pull(controller) {
            if (count === 0) {
              running++
              maxRunning = Math.max(maxRunning, running)
            }

            await sleep(10)

            if (count++ < 2) {
              controller.enqueue(count)
            }
            else {
              running--
              controller.close()
            }
          },
        })
      })

      const consume = async () => {
        const stream = await call(procedure, undefined, { context: {} })
        expect(stream).toBeInstanceOf(ReadableStream)

        const chunks: number[] = []

        for await (const chunk of stream) {
          chunks.push(chunk)
        }

        return chunks
      }

      await expect(Promise.all([consume(), consume()])).resolves.toEqual([[1, 2], [1, 2]])
      expect(maxRunning).toBe(1)

      await sleep(0)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock when a ReadableStream output is cancelled', async () => {
      const locker = new MemoryLocker()
      const cancel = vi.fn()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(() => new ReadableStream<number>({
        pull(controller) {
          controller.enqueue(1)
        },
        cancel,
      }))

      const stream = await call(procedure, undefined, { context: {} })
      const reader = stream.getReader()

      await expect(reader.read()).resolves.toEqual({ done: false, value: 1 })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await reader.cancel('reason')

      expect(cancel).toHaveBeenCalledWith('reason')
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock when a ReadableStream output errors', async () => {
      const locker = new MemoryLocker()
      const error = new Error('boom')
      const procedure = os.use(lock({ locker, key: 'k' })).handler(() => new ReadableStream<number>({
        pull(controller) {
          controller.error(error)
        },
      }))

      const stream = await call(procedure, undefined, { context: {} })

      await expect(stream.getReader().read()).rejects.toBe(error)

      await sleep(0)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })
  })
})
