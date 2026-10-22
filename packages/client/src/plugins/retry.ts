import type { Promisable, Value } from '@orpc/shared'
import type { StandardLinkInterceptorOptions, StandardLinkOptions, StandardLinkPlugin } from '../adapters/standard'
import type { ClientContext } from '../types'
import { AsyncIteratorClass, isAsyncIteratorObject, overlayProxy, value } from '@orpc/shared'
import { getEventMeta } from '@orpc/standard-server'

export interface ClientRetryPluginAttemptOptions<T extends ClientContext> extends StandardLinkInterceptorOptions<T> {
  lastEventRetry: number | undefined
  attemptIndex: number
  error: unknown
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
   *
   * @default (o) => o.lastEventRetry ?? 2000
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
}

export class ClientRetryPluginInvalidEventIteratorRetryResponse extends Error { }

export interface ClientRetryPluginOptions {
  default?: ClientRetryPluginContext
}

/**
 * The Client Retry Plugin enables retrying client calls when errors occur.
 *
 * @see {@link https://orpc.dev/docs/plugins/client-retry Client Retry Plugin Docs}
 */
export class ClientRetryPlugin<T extends ClientRetryPluginContext> implements StandardLinkPlugin<T> {
  private readonly defaultRetry: Exclude<ClientRetryPluginContext['retry'], undefined>
  private readonly defaultRetryDelay: Exclude<ClientRetryPluginContext['retryDelay'], undefined>
  private readonly defaultShouldRetry: Exclude<ClientRetryPluginContext['shouldRetry'], undefined>
  private readonly defaultOnRetry: ClientRetryPluginContext['onRetry']

  order = 1_800_000

  constructor(options: ClientRetryPluginOptions = {}) {
    this.defaultRetry = options.default?.retry ?? 0
    this.defaultRetryDelay = options.default?.retryDelay ?? (o => o.lastEventRetry ?? 2000)
    this.defaultShouldRetry = options.default?.shouldRetry ?? true
    this.defaultOnRetry = options.default?.onRetry
  }

  init(options: StandardLinkOptions<T>): void {
    options.interceptors ??= []

    options.interceptors.push(async (interceptorOptions) => {
      const maxAttempts = await value(
        interceptorOptions.context.retry ?? this.defaultRetry,
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
      let isIteratorAborted = false

      const next = async (initialError?: { error: unknown }) => {
        let currentError = initialError

        while (true) {
          const updatedInterceptorOptions = { ...interceptorOptions, lastEventId }

          if (currentError) {
            if (isIteratorAborted || attemptIndex >= maxAttempts) {
              throw currentError.error
            }

            const attemptOptions: ClientRetryPluginAttemptOptions<ClientRetryPluginContext> = {
              ...updatedInterceptorOptions,
              attemptIndex,
              error: currentError.error,
              lastEventRetry,
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

            await new Promise(resolve => setTimeout(resolve, retryDelayMs))

            if (isIteratorAborted) {
              callback?.(false)
              callback = undefined
              throw currentError.error
            }

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
