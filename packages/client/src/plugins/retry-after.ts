import type { Value } from '@orpc/shared'
import type { StandardLazyResponse } from '@orpc/standard-server'
import type { StandardLinkClientInterceptorOptions, StandardLinkOptions, StandardLinkPlugin } from '../adapters/standard'
import type { ClientContext } from '../types'
import { value } from '@orpc/shared'
import { flattenHeader } from '@orpc/standard-server'
import { COMMON_ORPC_ERROR_DEFS } from '../error'

export interface RetryAfterPluginOptions<T extends ClientContext> {
  /**
   * Override condition to determine whether to retry or not.
   *
   * @default ((response) => response.status === 429 || response.status === 503)
   */
  condition?: Value<boolean, [
    response: StandardLazyResponse,
    options: StandardLinkClientInterceptorOptions<T>,
  ]>

  /**
   * Maximum attempts before giving up retries.
   *
   * @default 3
   */
  maxAttempts?: Value<number, [
    response: StandardLazyResponse,
    options: StandardLinkClientInterceptorOptions<T>,
  ]>

  /**
   * Maximum timeout in milliseconds to wait before giving up retries.
   *
   * @default 5 * 60 * 1000 (5 minutes)
   */
  timeout?: Value<number, [
    response: StandardLazyResponse,
    options: StandardLinkClientInterceptorOptions<T>,
  ]>
}

/**
 * The Retry After Plugin automatically retries requests based on server `Retry-After` headers.
 * This is particularly useful for handling rate limiting and temporary server unavailability.
 *
 * @see {@link https://orpc.unnoq.com/docs/plugins/retry-after Retry After Plugin Docs}
 */
export class RetryAfterPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  private readonly condition: Exclude<RetryAfterPluginOptions<T>['condition'], undefined>
  private readonly maxAttempts: Exclude<RetryAfterPluginOptions<T>['maxAttempts'], undefined>
  private readonly timeout: Exclude<RetryAfterPluginOptions<T>['timeout'], undefined>

  order = 1_900_000

  constructor(options: RetryAfterPluginOptions<T> = {}) {
    this.condition = options.condition ?? (
      response =>
        response.status === COMMON_ORPC_ERROR_DEFS.TOO_MANY_REQUESTS.status
        || response.status === COMMON_ORPC_ERROR_DEFS.SERVICE_UNAVAILABLE.status
    )

    this.maxAttempts = options.maxAttempts ?? 3
    this.timeout = options.timeout ?? 5 * 60 * 1000 // 5 minutes
  }

  init(options: StandardLinkOptions<T>): void {
    options.clientInterceptors ??= []

    options.clientInterceptors.push(async (interceptorOptions) => {
      const startTime = Date.now()
      let attemptCount = 0

      while (true) {
        attemptCount++

        const response = await interceptorOptions.next()

        if (!value(this.condition, response, interceptorOptions)) {
          return response
        }

        const retryAfterHeader = flattenHeader(response.headers['retry-after'])
        const retryAfterMs = this.parseRetryAfterHeader(retryAfterHeader)
        if (retryAfterMs === undefined) {
          return response
        }

        if (attemptCount >= value(this.maxAttempts, response, interceptorOptions)) {
          return response
        }

        const timeoutMs = value(this.timeout, response, interceptorOptions)
        const elapsedTime = Date.now() - startTime
        if (elapsedTime + retryAfterMs > timeoutMs) {
          return response
        }

        await this.delayExecution(retryAfterMs, interceptorOptions.signal)
        if (interceptorOptions.signal?.aborted) {
          return response
        }
      }
    })
  }

  private parseRetryAfterHeader(value: string | undefined): number | undefined {
    value = value?.trim()

    if (!value) {
      return undefined
    }

    const seconds = Number(value)
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000)
    }

    const retryDate = Date.parse(value)
    if (!Number.isNaN(retryDate)) {
      return Math.max(0, retryDate - Date.now())
    }

    return undefined
  }

  private delayExecution(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve()
        return
      }

      let timeout: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => {
        clearTimeout(timeout)
        timeout = undefined
        resolve()
      }

      signal?.addEventListener('abort', onAbort, { once: true })

      timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
    })
  }
}
