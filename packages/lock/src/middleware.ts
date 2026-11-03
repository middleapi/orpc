import type { Context, Middleware, MiddlewareOptions, MiddlewareResult } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { Locker } from './types'
import { ORPCError } from '@orpc/server'
import { isAsyncIteratorObject, override, promiseWithResolvers, toArray, value, wrapAsyncIterator, wrapReadableStream } from '@orpc/shared'
import { LockTimeoutError } from './error'

export const LOCK_MIDDLEWARE_CONTEXT_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for('ORPC_LOCK_MIDDLEWARE_CONTEXT')

export interface LockMiddlewareContext {
  [LOCK_MIDDLEWARE_CONTEXT_SYMBOL]?: {
    /**
     * The locks held in this request, mainly for deduplication purposes
     */
    held: { locker: Locker, key: string, waited: boolean }[]
  }
}

export interface LockMiddlewareOutContext {
  /**
   * Whether the lock was acquired only after waiting for another holder to release it.
   * `false` means the lock was acquired immediately.
   */
  ['lock/waited']: boolean
}

export interface LockMiddlewareOptions<
  TInContext extends Context,
  TInput,
> {
  /**
   * The locker to acquire the lock from
   */
  locker: Value<Promisable<Locker>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * The key to identify the work that must not run concurrently
   */
  key: Value<Promisable<string>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>

  /**
   * How long the lock is held before it expires automatically, in milliseconds.
   *
   * @default the adapter default
   */
  ttl?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]> | undefined

  /**
   * How long to wait for the lock to become available, in milliseconds.
   *
   * @default the adapter default
   */
  timeout?: Value<Promisable<number | undefined>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]> | undefined

  /**
   * If your lock middleware is used multiple times
   * or you invoke a procedure inside another procedure (shared the same context) that also has
   * lock middleware **with the same locker and key**, this option
   * will ensure that the lock is only acquired once per request,
   * instead of waiting for itself until the timeout elapses.
   *
   * @default true
   */
  dedupe?: boolean | undefined
}

/**
 * Creates a middleware that runs oRPC procedures under a lock, so that calls
 * sharing the same key never run concurrently. Rejects with a `CONFLICT` error
 * when the lock cannot be acquired before the timeout elapses.
 *
 * For streaming outputs (async iterator objects and readable streams), the lock
 * is held until the output completes, throws, or is cancelled. An output that is
 * never consumed or cancelled keeps the lock until its `ttl` expires.
 *
 * @see {@link https://orpc.dev/docs/helpers/lock#lock-middleware | Lock Helpers - Lock Middleware}
 */
export function lock<
  TInContext extends Context,
  TInput,
>(
  { dedupe = true, ...options }: LockMiddlewareOptions<TInContext, TInput>,
): Middleware<TInContext, LockMiddlewareOutContext, TInput, any, object> {
  return async function lock(middlewareOptions, input) {
    const [locker, key, ttl, timeout] = await Promise.all([
      value(options.locker, middlewareOptions, input),
      value(options.key, middlewareOptions, input),
      value(options.ttl, middlewareOptions, input),
      value(options.timeout, middlewareOptions, input),
    ])

    const middlewareContext = (middlewareOptions.context as LockMiddlewareContext)[LOCK_MIDDLEWARE_CONTEXT_SYMBOL]
    const held = middlewareContext?.held.find(l => l.key === key && l.locker === locker)

    if (dedupe && held) {
      return middlewareOptions.next({
        context: {
          'lock/waited': held.waited,
        } satisfies LockMiddlewareOutContext,
      })
    }

    let acquired = false
    const streaming = promiseWithResolvers<Awaited<MiddlewareResult<LockMiddlewareOutContext & LockMiddlewareContext, unknown>>>()

    const locked = locker.lock(key, async ({ waited }) => {
      acquired = true

      const result = await middlewareOptions.next({
        context: {
          'lock/waited': waited,
          [LOCK_MIDDLEWARE_CONTEXT_SYMBOL]: {
            ...middlewareContext,
            held: [
              ...toArray(middlewareContext?.held),
              { locker, key, waited },
            ],
          },
        } satisfies LockMiddlewareOutContext & LockMiddlewareContext,
      })

      const output = result.output
      const isIterator = isAsyncIteratorObject(output)

      if (!isIterator && !(output instanceof ReadableStream)) {
        return result
      }

      /**
       * The output is only produced while it is consumed, so keep holding the lock
       * until it completes, throws, or is cancelled. Finishing waits for the release,
       * so a failed release surfaces to the consumer.
       */
      const finished = promiseWithResolvers<void>()
      const onFinish = async () => {
        finished.resolve()
        await locked
      }

      /**
       * @remarks
       * **Warning**: Remember use `override` to remain other special properties
       */
      streaming.resolve({
        ...result,
        output: isIterator
          ? override(output, wrapAsyncIterator(output, { onFinish }))
          : override(output, wrapReadableStream(output as ReadableStream, { onFinish })),
      })

      await finished.promise

      return result
    }, { ttl, timeout, signal: middlewareOptions.signal })

    try {
      return await Promise.race([locked, streaming.promise])
    }
    catch (error) {
      if (!acquired && error instanceof LockTimeoutError) {
        throw new ORPCError('CONFLICT', { cause: error })
      }

      throw error
    }
  }
}
