import type { Locker } from './types'
import { call, getEventMeta, ORPCError, os, type, withEventMeta } from '@orpc/server'
import { sleep } from '@orpc/shared'
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
    const isHeld = (locker: Locker, key: string) =>
      locker.lock(key, () => false, { timeout: 0 }).catch(e => e instanceof LockTimeoutError)

    async function consume(iterator: AsyncIterable<unknown>) {
      const values: unknown[] = []
      for await (const value of iterator) {
        values.push(value)
      }
      return values
    }

    async function consumeStream(stream: ReadableStream) {
      const values: unknown[] = []
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          return values
        }
        values.push(value)
      }
    }

    it('keeps async iterator calls sharing a key from running concurrently', async () => {
      let running = 0
      let maxRunning = 0
      const procedure = os
        .use(lock({ locker: new MemoryLocker(), key: 'k' }))
        .handler(async function* () {
          running++
          maxRunning = Math.max(maxRunning, running)
          await sleep(20)
          yield 1
          await sleep(20)
          yield 2
          running--
        })

      const results = await Promise.all([
        call(procedure, undefined, { context: {} }).then(consume),
        call(procedure, undefined, { context: {} }).then(consume),
        call(procedure, undefined, { context: {} }).then(consume),
      ])

      expect(results).toEqual([[1, 2], [1, 2], [1, 2]])
      expect(maxRunning).toBe(1)
    })

    it('keeps readable stream calls sharing a key from running concurrently', async () => {
      let running = 0
      let maxRunning = 0
      const procedure = os
        .use(lock({ locker: new MemoryLocker(), key: 'k' }))
        .handler(() => new ReadableStream<number>({
          async pull(controller) {
            running++
            maxRunning = Math.max(maxRunning, running)
            await sleep(20)
            controller.enqueue(1)
            controller.close()
            running--
          },
        }, { highWaterMark: 0 }))

      const results = await Promise.all([
        call(procedure, undefined, { context: {} }).then(consumeStream),
        call(procedure, undefined, { context: {} }).then(consumeStream),
      ])

      expect(results).toEqual([[1], [1]])
      expect(maxRunning).toBe(1)
    })

    it('holds the lock until the iterator completes', async () => {
      const locker = new MemoryLocker()
      const procedure = os
        .use(lock({ locker, key: 'k' }))
        .handler(async function* () {
          yield 1
          yield 2
        })

      const iterator = await call(procedure, undefined, { context: {} })
      expect(await isHeld(locker, 'k')).toBe(true)

      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
      expect(await isHeld(locker, 'k')).toBe(true)

      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
      expect(await isHeld(locker, 'k')).toBe(false)
    })

    it('releases the lock after an early return', async () => {
      const locker = new MemoryLocker()
      let finished = false
      const procedure = os
        .use(lock({ locker, key: 'k' }))
        .handler(async function* () {
          try {
            yield 1
            yield 2
          }
          finally {
            finished = true
          }
        })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      expect(await isHeld(locker, 'k')).toBe(true)

      await iterator.return(undefined)

      expect(finished).toBe(true)
      expect(await isHeld(locker, 'k')).toBe(false)
    })

    it('releases the lock after an error mid-stream', async () => {
      const locker = new MemoryLocker()
      const error = new Error('mid-stream')
      const procedure = os
        .use(lock({ locker, key: 'k' }))
        .handler(async function* () {
          yield 1
          throw error
        })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      expect(await isHeld(locker, 'k')).toBe(true)
      await expect(iterator.next()).rejects.toBe(error)

      expect(await isHeld(locker, 'k')).toBe(false)
    })

    it('releases the lock when the signal aborts and the handler honors it', async () => {
      const locker = new MemoryLocker()
      const controller = new AbortController()
      const procedure = os
        .use(lock({ locker, key: 'k' }))
        .handler(async function* ({ signal }) {
          yield 1
          await sleep(10_000, { signal })
          yield 2
        })

      const iterator = await call(procedure, undefined, { context: {}, signal: controller.signal })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      expect(await isHeld(locker, 'k')).toBe(true)

      const next = iterator.next()
      controller.abort(new Error('aborted'))

      await expect(next).rejects.toThrow('aborted')
      expect(await isHeld(locker, 'k')).toBe(false)
    })

    it('releases the lock when a readable stream is cancelled or errors', async () => {
      const locker = new MemoryLocker()
      const error = new Error('stream error')
      const cancel = vi.fn()
      const procedure = os
        .input(type<'cancel' | 'error'>())
        .use(lock({ locker, key: 'k' }))
        .handler(({ input }) => new ReadableStream({
          pull(controller) {
            if (input === 'error') {
              controller.error(error)
            }
            else {
              controller.enqueue(1)
            }
          },
          cancel,
        }, { highWaterMark: 0 }))

      const cancelled = await call(procedure, 'cancel', { context: {} })
      const reader = cancelled.getReader()
      await expect(reader.read()).resolves.toEqual({ done: false, value: 1 })
      expect(await isHeld(locker, 'k')).toBe(true)
      await reader.cancel('reason')
      expect(cancel).toHaveBeenCalledWith('reason')
      expect(await isHeld(locker, 'k')).toBe(false)

      const errored = await call(procedure, 'error', { context: {} })
      expect(await isHeld(locker, 'k')).toBe(true)
      await expect(errored.getReader().read()).rejects.toBe(error)
      expect(await isHeld(locker, 'k')).toBe(false)
    })

    it('surfaces release errors to the consumer', async () => {
      const error = new Error('release failed')
      const locker: Locker = {
        async lock(_key, fn) {
          await fn({ waited: false })
          throw error
        },
      }
      const procedure = os
        .use(lock({ locker, key: 'k' }))
        .handler(async function* () {
          yield 1
        })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(iterator.next()).rejects.toBe(error)
    })

    it('preserves event meta', async () => {
      const procedure = os
        .use(lock({ locker: new MemoryLocker(), key: 'k' }))
        .handler(async function* () {
          yield withEventMeta({ value: 1 }, { id: 'id-1' })
        })

      const iterator = await call(procedure, undefined, { context: {} })
      const { value } = await iterator.next()

      expect(getEventMeta(value)).toEqual({ id: 'id-1' })
    })

    it('holds the outer lock while a deduped nested iterator runs', async () => {
      const locker = new MemoryLocker()
      const mw = lock({ locker, key: 'k' })
      const inner = os.use(mw).handler(async function* () {
        yield 1
      })
      const outer = os.use(mw).handler(async function* ({ context }) {
        yield* await call(inner, undefined, { context })
      })

      const iterator = await call(outer, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      expect(await isHeld(locker, 'k')).toBe(true)
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
      expect(await isHeld(locker, 'k')).toBe(false)
    })
  })
})
