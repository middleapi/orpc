import type { Locker } from './types'
import { call, ORPCError, os, type } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { sleep, stringifyJSON } from '@orpc/shared'
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
        { locker, key: 'k', waited: false, released: true },
        { locker, key: 'k', waited: false, released: true },
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

    it('acquires again once the held lock is released', async () => {
      const locker = createLocker()
      const mw = lock({ locker, key: 'k' })
      const inner = os.use(mw).handler(() => 'in')

      let context: any
      const outer = os.use(mw).handler(({ context: ctx }) => {
        context = ctx
        return 'out'
      })

      await call(outer, undefined, { context: {} })
      expect(locker.lock).toHaveBeenCalledTimes(1)

      // e.g. background work started by the handler that outlives the lock
      await call(inner, undefined, { context })
      expect(locker.lock).toHaveBeenCalledTimes(2)
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
    /**
     * Resolves whether `key` is currently held, without waiting for it.
     */
    const isLocked = (locker: Locker, key: string) => locker.lock(key, () => false, { timeout: 0 }).catch((error) => {
      if (error instanceof LockTimeoutError) {
        return true
      }

      throw error
    })

    it('serializes same-key calls over HTTP, for both plain and streaming handlers', async () => {
      const payouts = async (streaming: boolean) => {
        let balance = 100
        const paid: number[] = []

        const withdraw = async (amount: number) => {
          const current = balance
          await sleep(30)

          if (current >= amount) {
            balance = current - amount
            paid.push(amount)
          }
        }

        const base = os
          .input(type<{ account: string, amount: number }>())
          .use(lock({ locker: new MemoryLocker(), key: (_, input) => `acct:${input.account}` }))

        const handler = new RPCHandler({
          withdraw: streaming
            ? base.handler(async function* ({ input }) {
                yield 'before'
                await withdraw(input.amount)
                yield 'after'
              })
            : base.handler(({ input }) => withdraw(input.amount)),
        })

        await Promise.all(Array.from({ length: 3 }, async () => {
          const { response } = await handler.handle(new Request('http://localhost/withdraw', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: stringifyJSON({ json: { account: 'a', amount: 100 } }),
          }))

          expect(response?.status).toBe(200)
          await response?.text()
        }))

        return paid
      }

      await expect(payouts(false)).resolves.toEqual([100])
      await expect(payouts(true)).resolves.toEqual([100])
    })

    it('serializes same-key async iterator outputs', async () => {
      const locker = new MemoryLocker()
      const events: string[] = []
      const procedure = os
        .input(type<string>())
        .use(lock({ locker, key: 'k' }))
        .handler(async function* ({ input, context }) {
          events.push(`${input}:start:${context['lock/waited']}`)
          await sleep(10)
          yield input
          await sleep(10)
          events.push(`${input}:end`)
        })

      const consume = async (input: string) => {
        const values: string[] = []

        for await (const value of await call(procedure, input, { context: {} })) {
          values.push(value)
        }

        return values
      }

      await expect(Promise.all([consume('a'), consume('b')])).resolves.toEqual([['a'], ['b']])
      expect(events).toEqual(['a:start:false', 'a:end', 'b:start:true', 'b:end'])
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock once the async iterator finishes', async () => {
      const locker = new MemoryLocker()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        yield 1
        yield 2
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock once the async iterator errors', async () => {
      const locker = new MemoryLocker()
      const error = new Error('failed')
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        yield 1
        throw error
      })

      const iterator = await call(procedure, undefined, { context: {} })

      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await expect(iterator.next()).rejects.toBe(error)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock once the async iterator is cancelled, after its cleanup ran under the lock', async () => {
      const locker = new MemoryLocker()
      let lockedDuringCleanup: boolean | undefined
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        try {
          yield 1
          yield 2
        }
        finally {
          lockedDuringCleanup = await isLocked(locker, 'k')
        }
      })

      const iterator = await call(procedure, undefined, { context: {} })

      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
      await iterator.return(undefined)

      expect(lockedDuringCleanup).toBe(true)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('releases the lock when an async iterator is cancelled before being consumed', async () => {
      const locker = new MemoryLocker()
      const handler = vi.fn()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async function* () {
        handler()
        yield 1
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await iterator.return(undefined)
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
      expect(handler).not.toHaveBeenCalled()
    })

    it('holds the lock until a readable stream finishes', async () => {
      const locker = new MemoryLocker()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(() => {
        let count = 0

        return new ReadableStream<number>({
          async pull(controller) {
            await sleep(1)

            if (count < 2) {
              controller.enqueue(count++)
            }
            else {
              controller.close()
            }
          },
        }, { highWaterMark: 0 })
      })

      const stream = await call(procedure, undefined, { context: {} })
      expect(stream).toBeInstanceOf(ReadableStream)
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      const reader = stream.getReader()
      await expect(reader.read()).resolves.toEqual({ done: false, value: 0 })
      await expect(reader.read()).resolves.toEqual({ done: false, value: 1 })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      await vi.waitFor(() => expect(isLocked(locker, 'k')).resolves.toBe(false))
    })

    it('releases the lock once a readable stream errors', async () => {
      const locker = new MemoryLocker()
      const error = new Error('failed')
      const procedure = os.use(lock({ locker, key: 'k' })).handler(() => {
        let pulled = false

        return new ReadableStream<number>({
          async pull(controller) {
            await sleep(1)

            if (pulled) {
              controller.error(error)
            }
            else {
              pulled = true
              controller.enqueue(1)
            }
          },
        }, { highWaterMark: 0 })
      })

      const stream = await call(procedure, undefined, { context: {} })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      const reader = stream.getReader()
      await expect(reader.read()).resolves.toEqual({ done: false, value: 1 })
      await expect(reader.read()).rejects.toBe(error)
      await vi.waitFor(() => expect(isLocked(locker, 'k')).resolves.toBe(false))
    })

    it('releases the lock once a readable stream is cancelled', async () => {
      const locker = new MemoryLocker()
      const cancel = vi.fn()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(() => new ReadableStream<number>({
        pull(controller) {
          controller.enqueue(1)
        },
        cancel,
      }, { highWaterMark: 0 }))

      const stream = await call(procedure, undefined, { context: {} })
      const reader = stream.getReader()

      await expect(reader.read()).resolves.toEqual({ done: false, value: 1 })
      await expect(isLocked(locker, 'k')).resolves.toBe(true)

      await reader.cancel('reason')
      expect(cancel).toHaveBeenCalledWith('reason')
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })

    it('rejects with CONFLICT while a stream holds the lock past the timeout', async () => {
      const locker = new MemoryLocker()
      const procedure = os.use(lock({ locker, key: 'k', timeout: 10 })).handler(async function* () {
        yield 1
        yield 2
      })

      const iterator = await call(procedure, undefined, { context: {} })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })

      await expect(call(procedure, undefined, { context: {} })).rejects.toSatisfy(
        (error: unknown) => error instanceof ORPCError && error.code === 'CONFLICT' && error.cause instanceof LockTimeoutError,
      )

      await iterator.return(undefined)

      const next = await call(procedure, undefined, { context: {} })
      await expect(next.next()).resolves.toEqual({ done: false, value: 1 })
      await next.return(undefined)
    })

    it('dedupes nested calls while the stream holds the lock, but not after it is released', async () => {
      const locker = new MemoryLocker()
      const lockSpy = vi.spyOn(locker, 'lock')
      const mw = lock({ locker, key: 'k', timeout: 0 })
      const inner = os.use(mw).handler(() => 'in')

      let context: any
      const outer = os.use(mw).handler(async function* ({ context: ctx }) {
        context = ctx
        yield await call(inner, undefined, { context })
      })

      const values: string[] = []
      for await (const value of await call(outer, undefined, { context: {} })) {
        values.push(value)
      }

      expect(values).toEqual(['in'])
      expect(lockSpy).toHaveBeenCalledTimes(1)

      // e.g. background work started by the stream that outlives the lock
      await expect(call(inner, undefined, { context })).resolves.toBe('in')
      expect(lockSpy).toHaveBeenCalledTimes(2)
    })

    it('surfaces errors from releasing the lock at the end of the stream', async () => {
      const error = new Error('release failed')
      const locker: Locker = {
        async lock(_key, fn) {
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

    it('releases the lock before resolving non-streaming outputs', async () => {
      const locker = new MemoryLocker()
      const procedure = os.use(lock({ locker, key: 'k' })).handler(async () => {
        await expect(isLocked(locker, 'k')).resolves.toBe(true)
        return { nested: (async function* () {})() }
      })

      const output = await call(procedure, undefined, { context: {} })

      expect(output).toEqual({ nested: expect.any(Object) })
      await expect(isLocked(locker, 'k')).resolves.toBe(false)
    })
  })
})
