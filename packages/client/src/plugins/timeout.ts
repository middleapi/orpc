import type { Value } from '@orpc/shared'
import type { StandardLinkInterceptor, StandardLinkInterceptorOptions, StandardLinkOptions, StandardLinkPlugin } from '../adapters/standard'
import type { ClientContext } from '../types'
import { AbortError, anyAbortSignal, toArray, value } from '@orpc/shared'

/**
 * Timers fire after about 1ms for delays above this (about 24.8 days).
 */
const MAX_TIMER_DELAY = 2_147_483_647

export interface TimeoutLinkPluginOptions<T extends ClientContext> {
  /**
   * Timeout in milliseconds before the request is aborted.
   * Use `null` or `undefined` to disable the timeout.
   * Non-finite values like `Infinity` never time out.
   */
  timeout: Value<number | null | undefined, [options: StandardLinkInterceptorOptions<T>]>
}

/**
 * The Timeout Link Plugin aborts requests that exceed a configured timeout with an `AbortError`.
 *
 * @see {@link https://orpc.dev/docs/plugins/timeout | Timeout Plugin}
 */
export class TimeoutLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  private readonly timeout: TimeoutLinkPluginOptions<T>['timeout']

  name = '~timeout'

  /**
   * Should abort if the total retry time exceeds the configured timeout
   */
  after = ['~retry']

  constructor(options: NoInfer<TimeoutLinkPluginOptions<T>>) {
    this.timeout = options.timeout
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const interceptor: StandardLinkInterceptor<T> = async (interceptorOptions) => {
      const timeoutMs = value(this.timeout, interceptorOptions)

      if (timeoutMs === null || timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
        return interceptorOptions.next()
      }

      const controller = new AbortController()
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      /**
       * Delays above MAX_TIMER_DELAY would fire right away, so wait in chunks.
       */
      const schedule = (remainingMs: number) => {
        timeoutId = remainingMs > MAX_TIMER_DELAY
          ? setTimeout(schedule, MAX_TIMER_DELAY, remainingMs - MAX_TIMER_DELAY)
          : setTimeout(() => {
              controller.abort(new AbortError(`Request timed out after ${timeoutMs}ms`))
            }, remainingMs)
      }

      schedule(timeoutMs)

      const signal = anyAbortSignal([interceptorOptions.signal, controller.signal])

      try {
        return await interceptorOptions.next({ ...interceptorOptions, signal })
      }
      finally {
        clearTimeout(timeoutId)
      }
    }

    return { ...options, interceptors: [interceptor, ...toArray(options.interceptors)] }
  }
}
