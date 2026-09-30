import type { Promisable } from '@orpc/shared'
import type { LockCallbackOptions, Locker, LockOptions } from '../types'
import { promiseWithResolvers, throwIfAborted } from '@orpc/shared'
import { LockTimeoutError } from '../error'

export interface MemoryLockerOptions {
  /**
   * How long a lock is held before it expires automatically, in milliseconds.
   * Guards against holders that never release the lock.
   * Can be overridden per call.
   *
   * @default undefined (held until released)
   */
  ttl?: number

  /**
   * How long to wait for a lock to become available, in milliseconds.
   * Use `Infinity` to wait until the lock is released.
   * Can be overridden per call.
   *
   * @default 10000
   */
  timeout?: number
}

/**
 * Timers fire after about 1ms for delays above this (about 24.8 days).
 */
const MAX_TIMER_DELAY = 2_147_483_647

/**
 * Like `setTimeout`, but never fires for non-finite delays like `Infinity`,
 * and waits in chunks for delays above MAX_TIMER_DELAY instead of firing right away.
 * Returns a function that cancels the timer.
 */
function setLongTimeout(callback: () => void, delay: number): () => void {
  if (!Number.isFinite(delay)) {
    return () => {}
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (remaining: number) => {
    timer = remaining > MAX_TIMER_DELAY
      ? setTimeout(schedule, MAX_TIMER_DELAY, remaining - MAX_TIMER_DELAY)
      : setTimeout(callback, remaining)
  }

  schedule(delay)

  return () => clearTimeout(timer)
}

interface MemoryLockWaiter {
  token: object
  resolve: () => void
}

interface MemoryLockEntry {
  holder: object
  cancelExpiry?: () => void
  waiters: Set<MemoryLockWaiter>
}

/**
 * Locker adapter backed by in-memory storage, so locks are only shared within
 * the current process. Waiters acquire the lock in order, without polling.
 *
 * @see {@link https://orpc.dev/docs/helpers/lock#adapters | Lock Helpers - Adapters}
 */
export class MemoryLocker implements Locker {
  private readonly ttl: number | undefined
  private readonly timeout: number

  private readonly entries = new Map<string, MemoryLockEntry>()

  constructor(options: MemoryLockerOptions = {}) {
    this.ttl = options.ttl
    this.timeout = options.timeout ?? 10_000
  }

  async lock<T>(key: string, fn: (options: LockCallbackOptions) => Promisable<T>, options: LockOptions = {}): Promise<T> {
    const ttl = options.ttl ?? this.ttl
    const timeout = options.timeout ?? this.timeout
    const token = {}

    throwIfAborted(options.signal)

    let entry = this.entries.get(key)
    const waited = entry !== undefined

    if (entry) {
      await this.wait(key, entry, token, timeout, options.signal)
    }
    else {
      entry = { holder: token, waiters: new Set() }
      this.entries.set(key, entry)
    }

    if (ttl !== undefined) {
      entry.cancelExpiry = setLongTimeout(() => this.release(key, token), ttl)
    }

    try {
      return await fn({ waited })
    }
    finally {
      this.release(key, token)
    }
  }

  private wait(key: string, entry: MemoryLockEntry, token: object, timeout: number, signal: AbortSignal | undefined): Promise<void> {
    if (timeout <= 0) {
      return Promise.reject(new LockTimeoutError(key))
    }

    const { promise, resolve, reject } = promiseWithResolvers<void>()
    const waiter: MemoryLockWaiter = { token, resolve }
    entry.waiters.add(waiter)

    const fail = (reason: unknown) => {
      entry.waiters.delete(waiter)
      reject(reason)
    }

    const cancelTimer = setLongTimeout(() => fail(new LockTimeoutError(key)), timeout)
    const abortListener = () => fail(signal?.reason)
    signal?.addEventListener('abort', abortListener, { once: true })

    return promise.finally(() => {
      cancelTimer()
      signal?.removeEventListener('abort', abortListener)
    })
  }

  private release(key: string, token: object): void {
    const entry = this.entries.get(key)

    if (entry?.holder !== token) {
      return
    }

    entry.cancelExpiry?.()

    const [next] = entry.waiters

    if (!next) {
      this.entries.delete(key)
      return
    }

    entry.waiters.delete(next)
    entry.holder = next.token
    next.resolve()
  }
}
