import type { Promisable, Value } from '@orpc/shared'
import type { StandardLinkInterceptorOptions, StandardLinkOptions, StandardLinkPlugin } from '../adapters/standard'
import type { ClientContext } from '../types'
import { AsyncIteratorClass, isAsyncIteratorObject, overlayProxy, value } from '@orpc/shared'
import { getEventMeta } from '@orpc/standard-server'
import { ORPCError } from '../error'

export interface ClientRetryPluginAttemptOptions<T extends ClientContext> extends StandardLinkInterceptorOptions<T> {
  lastEventRetry: number | undefined
  attemptIndex: number
  error: unknown
  retryAfter: number | undefined
  elapsedTime: number
}

export interface ClientRetryPluginContext {
  /**
   * Maximum retry attempts before throwing
   * Use `Number.POSITIVE_INFINITY` for infinite retries (e.g., when handling Server-Sent Events).
   *
   * @default 0
   */
  retry?: Value<Promisable<number>, [StandardLinkInterceptorOptions<ClientRetryPluginContext>]>

  /**
   * Delay (in ms) before retrying.
   * If the error response includes a Retry-After header, it will be used automatically.
   *
   * @default (o) => o.retryAfter ?? o.lastEventRetry ?? 2000
   */
  retryDelay?: Value<Promisable<number>, [ClientRetryPluginAttemptOptions<ClientRetryPluginContext>]>

  /**
   * Determine should retry or not.
   *
   * @default true
   */
  shouldRetry?: Value<Promisable<boolean>, [ClientRetryPluginAttemptOptions<ClientRetryPluginContext>]>

  /**
   * The hook called when retrying, and return the unsubscribe function.
   */
  onRetry?: (options: ClientRetryPluginAttemptOptions<ClientRetryPluginContext>) => void | ((isSuccess: boolean) => void)

  /**
   * Maximum time (in ms) to spend retrying before giving up.
   * If undefined, no timeout is enforced.
   *
   * @default undefined
   */
  retryTimeout?: Value<Promisable<number | undefined>, [StandardLinkInterceptorOptions<ClientRetryPluginContext>]>
}

export class ClientRetryPluginInvalidEventIteratorRetryResponse extends Error { }

export interface ClientRetryPluginOptions {
  default?: ClientRetryPluginContext
}

/**
 * Parse the Retry-After header value and return delay in milliseconds.
 * Supports both delay-seconds and HTTP-date formats.
 *
 * @param retryAfter - The Retry-After header value
 * @returns Delay in milliseconds, or undefined if invalid
 */
function parseRetryAfter(retryAfter: string | string[] | undefined): number | undefined {
  if (!retryAfter) {
    return undefined
  }

  const value = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter
  if (!value) {
    return undefined
  }

  // Try parsing as delay-seconds (integer)
  const delaySeconds = Number.parseInt(value, 10)
  if (!Number.isNaN(delaySeconds) && delaySeconds >= 0) {
    return delaySeconds * 1000
  }

  // Try parsing as HTTP-date
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now()
    return Math.max(0, delay)
  }

  return undefined
}

/**
 * Extract the Retry-After header from an error response.
 *
 * @param error - The error object
 * @returns Delay in milliseconds, or undefined if not available
 */
function getRetryAfterFromError(error: unknown): number | undefined {
  if (!(error instanceof ORPCError)) {
    return undefined
  }

  // Check if the error has response data with headers
  const data = error.data
  if (!data || typeof data !== 'object' || !('headers' in data)) {
    return undefined
  }

  const headers = (data as any).headers
  if (!headers || typeof headers !== 'object') {
    return undefined
  }

  // Try different case variations of the header
  const retryAfter = headers['retry-after'] ?? headers['Retry-After']
  return parseRetryAfter(retryAfter)
}

/**
 * The Client Retry Plugin enables retrying client calls when errors occur.
 *
 * @see {@link https://orpc.unnoq.com/docs/plugins/client-retry Client Retry Plugin Docs}
 */
export class ClientRetryPlugin<T extends ClientRetryPluginContext> implements StandardLinkPlugin<T> {
  private readonly defaultRetry: Exclude<ClientRetryPluginContext['retry'], undefined>
  private readonly defaultRetryDelay: Exclude<ClientRetryPluginContext['retryDelay'], undefined>
  private readonly defaultShouldRetry: Exclude<ClientRetryPluginContext['shouldRetry'], undefined>
  private readonly defaultOnRetry: ClientRetryPluginContext['onRetry']
  private readonly defaultRetryTimeout: ClientRetryPluginContext['retryTimeout']

  order = 1_800_000

  constructor(options: ClientRetryPluginOptions = {}) {
    this.defaultRetry = options.default?.retry ?? 0
    this.defaultRetryDelay = options.default?.retryDelay ?? (o => o.retryAfter ?? o.lastEventRetry ?? 2000)
    this.defaultShouldRetry = options.default?.shouldRetry ?? true
    this.defaultOnRetry = options.default?.onRetry
    this.defaultRetryTimeout = options.default?.retryTimeout
  }

  init(options: StandardLinkOptions<T>): void {
    options.interceptors ??= []

    options.interceptors.push(async (interceptorOptions) => {
      const maxAttempts = await value(
        interceptorOptions.context.retry ?? this.defaultRetry,
        interceptorOptions,
      )

      const retryTimeout = await value(
        interceptorOptions.context.retryTimeout ?? this.defaultRetryTimeout,
        interceptorOptions,
      )

      const retryDelay = interceptorOptions.context.retryDelay ?? this.defaultRetryDelay
      const shouldRetry = interceptorOptions.context.shouldRetry ?? this.defaultShouldRetry
      const onRetry = interceptorOptions.context.onRetry ?? this.defaultOnRetry

      if (maxAttempts <= 0) {
        return interceptorOptions.next()
      }

      let lastEventId = interceptorOptions.lastEventId
      let lastEventRetry: undefined | number
      let callback: void | ((isSuccess: boolean) => void)
      let attemptIndex = 0
      const startTime = Date.now()

      const next = async (initialError?: { error: unknown }) => {
        let currentError = initialError

        while (true) {
          const updatedInterceptorOptions = { ...interceptorOptions, lastEventId }

          if (currentError) {
            if (attemptIndex >= maxAttempts) {
              throw currentError.error
            }

            const elapsedTime = Date.now() - startTime

            // Check timeout before attempting retry
            if (retryTimeout !== undefined && elapsedTime >= retryTimeout) {
              throw currentError.error
            }

            // Extract retry-after from error response
            const retryAfter = getRetryAfterFromError(currentError.error)

            const attemptOptions: ClientRetryPluginAttemptOptions<ClientRetryPluginContext> = {
              ...updatedInterceptorOptions,
              attemptIndex,
              error: currentError.error,
              lastEventRetry,
              retryAfter,
              elapsedTime,
            }

            const shouldRetryBool = await value(
              shouldRetry,
              attemptOptions,
            )

            if (!shouldRetryBool) {
              throw currentError.error
            }

            callback = onRetry?.(attemptOptions)

            const retryDelayMs = await value(retryDelay, attemptOptions)

            // Check if the delay would exceed the timeout
            if (retryTimeout !== undefined && elapsedTime + retryDelayMs > retryTimeout) {
              throw currentError.error
            }

            await new Promise(resolve => setTimeout(resolve, retryDelayMs))

            attemptIndex++
          }

          try {
            currentError = undefined
            return await interceptorOptions.next(updatedInterceptorOptions)
          }
          catch (error) {
            currentError = { error }

            if (updatedInterceptorOptions.signal?.aborted) {
              throw error
            }
          }
          finally {
            callback?.(!currentError)
            callback = undefined
          }
        }
      }

      const output = await next()

      if (!isAsyncIteratorObject(output)) {
        return output
      }

      let current = output
      let isIteratorAborted = false

      return overlayProxy(() => current, new AsyncIteratorClass(
        async () => {
          while (true) {
            try {
              const item = await current.next()

              const meta = getEventMeta(item.value)
              lastEventId = meta?.id ?? lastEventId
              lastEventRetry = meta?.retry ?? lastEventRetry

              return item
            }
            catch (error) {
              const meta = getEventMeta(error)
              lastEventId = meta?.id ?? lastEventId
              lastEventRetry = meta?.retry ?? lastEventRetry

              const maybeEventIterator = await next({ error })

              if (!isAsyncIteratorObject(maybeEventIterator)) {
                throw new ClientRetryPluginInvalidEventIteratorRetryResponse(
                  'RetryPlugin: Expected an Event Iterator, got a non-Event Iterator',
                )
              }

              current = maybeEventIterator

              /**
               * If iterator is aborted while retrying, we should cleanup right away
               */
              if (isIteratorAborted) {
                await current.return?.()
                throw error
              }
            }
          }
        },
        async (reason) => {
          isIteratorAborted = true
          if (reason !== 'next') {
            await current.return?.()
          }
        },
      ))
    })
  }
}
