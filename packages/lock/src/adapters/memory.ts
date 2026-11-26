import type { Promisable } from '@orpc/shared'
import { listenAbort, promiseWithResolvers, throwIfAborted } from '@orpc/shared'

import { LockTimeoutError } from '../error'
import type { LockCallbackOptions, Locker, LockOptions } from '../types'

export interface MemoryLockerOptions {
  /**
   * How long a lock is held before it expires automatically, in milliseconds.
   * Guards against holders that never release the lock.
   * Can be overridden per call.
   */
  ttl: number

  /**
   * How long to wait for a lock to become available, in milliseconds.
   * Can be overridden per call.
   *
   * @default 10000
   */
  timeout?: number | undefined
}

interface MemoryLockWaiter {
  token: object
  ttl: number
  deadline: number
  resolve: () => void
  fail: (reason: unknown) => void
}

interface MemoryLockEntry {
  holder: object
  expiresAt: number
  waiters: Set<MemoryLockWaiter>
}

const MAX_TIMEOUT_DELAY = 2 ** 31 - 1

/**
 * Locker adapter backed by in-memory storage, so locks are only shared within
 * the current process. Waiters acquire the lock in order.
 *
 * @see {@link https://orpc.dev/docs/helpers/lock#adapters | Lock Helpers - Adapters}
 */
export class MemoryLocker implements Locker {
  private readonly ttl: number
  private readonly timeout: number

  private readonly entries = new Map<string, MemoryLockEntry>()

  constructor(options: MemoryLockerOptions) {
    this.ttl = options.ttl
    this.timeout = options.timeout ?? 10_000
  }

  async lock<T>(
    key: string,
    fn: (options: LockCallbackOptions) => Promisable<T>,
    options: LockOptions = {},
  ): Promise<T> {
    const ttl = options.ttl ?? this.ttl
    const timeout = options.timeout ?? this.timeout
    const token = {}

    throwIfAborted(options.signal)

    const entry = this.releaseExpired(key)
    const waited = entry !== undefined

    if (entry) {
      await this.wait(key, entry, token, ttl, timeout, options.signal)
    } else {
      this.entries.set(key, {
        holder: token,
        expiresAt: performance.now() + ttl,
        waiters: new Set(),
      })
    }

    const expiry =
      ttl <= MAX_TIMEOUT_DELAY ? setTimeout(() => this.release(key, token), ttl) : undefined

    try {
      return await fn({ waited })
    } finally {
      clearTimeout(expiry)
      this.release(key, token)
    }
  }

  private wait(
    key: string,
    entry: MemoryLockEntry,
    token: object,
    ttl: number,
    timeout: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (timeout <= 0) {
      return Promise.reject(new LockTimeoutError(key))
    }

    const { promise, resolve, reject } = promiseWithResolvers<void>()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadlineTimer =
      timeout <= MAX_TIMEOUT_DELAY
        ? setTimeout(() => {
            timedOut = true
            check()
          }, timeout)
        : undefined

    const waiter: MemoryLockWaiter = {
      token,
      ttl,
      deadline: performance.now() + timeout,
      resolve,
      fail: (reason) => {
        entry.waiters.delete(waiter)
        reject(reason)
      },
    }

    const check = () => {
      if (!entry.waiters.has(waiter)) {
        return
      }

      this.releaseExpired(key)

      if (entry.holder === token) {
        return
      }

      const now = performance.now()

      if (timedOut || waiter.deadline <= now) {
        waiter.fail(new LockTimeoutError(key))
        return
      }

      // a waiter ahead may take the lock and expire within its ttl
      let wakeAt = Math.min(waiter.deadline, entry.expiresAt)
      for (const ahead of entry.waiters) {
        if (ahead === waiter) {
          break
        }
        wakeAt = Math.min(wakeAt, now + ahead.ttl)
      }

      timer = setTimeout(check, Math.min(MAX_TIMEOUT_DELAY, Math.max(1, wakeAt - now)))
    }

    entry.waiters.add(waiter)
    check()

    const removeAbortListener = listenAbort(signal, waiter.fail)

    return promise.finally(() => {
      clearTimeout(timer)
      clearTimeout(deadlineTimer)
      removeAbortListener()
    })
  }

  private releaseExpired(key: string): MemoryLockEntry | undefined {
    let entry = this.entries.get(key)

    while (entry && entry.expiresAt <= performance.now()) {
      this.release(key, entry.holder)
      entry = this.entries.get(key)
    }

    return entry
  }

  private release(key: string, token: object): void {
    const entry = this.entries.get(key)

    if (entry?.holder !== token) {
      return
    }

    if (entry.waiters.size === 0) {
      this.entries.delete(key)
      return
    }

    const now = performance.now()

    for (const next of entry.waiters) {
      if (next.deadline <= now) {
        next.fail(new LockTimeoutError(key))
        continue
      }

      entry.waiters.delete(next)
      entry.holder = next.token
      entry.expiresAt = now + next.ttl
      next.resolve()
      return
    }

    this.entries.delete(key)
  }
}
