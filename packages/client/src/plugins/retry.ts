import type { Promisable, Value } from '@orpc/shared'
import type { StandardLinkInterceptor, StandardLinkInterceptorOptions, StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor } from '../adapters/standard'
import type { ClientContext } from '../types'
import { AsyncIteratorClass, isAsyncIteratorObject, override, sleep, toArray, value } from '@orpc/shared'
import { getEventMeta } from '@standard-server/core'

export interface RetryLinkPluginAttemptOptions<T extends RetryLinkPluginContext> extends StandardLinkInterceptorOptions<T> {
  /**
   * Latest retry delay advertised by the server via event metadata.
   */
  lastEventRetry: number | undefined

  /**
   * Current retry attempt number, starting at 1.
   */
  attempt: number

  /**
   * Error that triggered this retry attempt.
   */
  error: unknown
}

/**
 * Client context options that control retry behavior per call
 * when the `RetryLinkPlugin` is enabled.
 *
 * @see {@link https://orpc.dev/docs/plugins/retry | Retry Plugin}
 */
export interface RetryLinkPluginContext {
  /**
   * Maximum retry attempts before throwing.
   * Use `Number.POSITIVE_INFINITY` for infinite retries (e.g. for AsyncIteratorObject).
   *
   * @default 0
   */
  retry?: Value<Promisable<number>, [Omit<StandardLinkInterceptorOptions<RetryLinkPluginContext>, 'next'>]>

  /**
   * Delay (in ms) before retrying.
   *
   * @remarks
   * **Note**: Why 2000ms? The EventSource spec suggests a default retry delay of 2 seconds if it doesn't specify
   *
   * @default (o) => o.lastEventRetry ?? 2000
   */
  retryDelay?: Value<Promisable<number>, [RetryLinkPluginAttemptOptions<RetryLinkPluginContext>]>

  /**
   * Determine whether to retry.
   *
   * @default true
   */
  shouldRetry?: Value<Promisable<boolean>, [RetryLinkPluginAttemptOptions<RetryLinkPluginContext>]>

  /**
   * Hook called before each retry. Can return a cleanup callback.
   */
  onRetry?: (options: RetryLinkPluginAttemptOptions<RetryLinkPluginContext>) => void | ((isSuccess: boolean) => void)
}

export interface RetryLinkPluginOptions<_T extends RetryLinkPluginContext> {
  /**
   * Default retry options. Can be overridden by individual calls via the context.
   */
  default?: RetryLinkPluginContext | undefined
}

/**
 * Automatically retries failed requests based on customizable retry strategies,
 * improving the resilience of your application.
 *
 * @remarks
 * **Note**: Retry behavior is configured through the client context on each call.
 * Calls whose input or request body is a stream (`AsyncIteratorObject` or `ReadableStream`)
 * are never retried, because a stream can only be read once.
 *
 * @see {@link https://orpc.dev/docs/plugins/retry | Retry Plugin}
 */
export class RetryLinkPlugin<T extends RetryLinkPluginContext & ClientContext> implements StandardLinkPlugin<T> {
  private readonly defaultRetry: Exclude<RetryLinkPluginContext['retry'], undefined>
  private readonly defaultRetryDelay: Exclude<RetryLinkPluginContext['retryDelay'], undefined>
  private readonly defaultShouldRetry: Exclude<RetryLinkPluginContext['shouldRetry'], undefined>
  private readonly defaultOnRetry: RetryLinkPluginContext['onRetry']

  name = '~retry'

  private readonly CONTEXT_SYMBOL = Symbol('ORPC_RETRY_LINK_PLUGIN_CONTEXT')

  constructor(options: RetryLinkPluginOptions<T> = {}) {
    this.defaultRetry = options.default?.retry ?? 0
    this.defaultRetryDelay = options.default?.retryDelay ?? (o => o.lastEventRetry ?? 2000)
    this.defaultShouldRetry = options.default?.shouldRetry ?? true
    this.defaultOnRetry = options.default?.onRetry
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    type PluginContext = {
      /**
       * Set to `false` by the transport interceptor once a request body is a stream.
       */
      isReplayable: boolean
    }

    const interceptor: StandardLinkInterceptor<T> = async (interceptorOptions) => {
      const { next, ...callOptions } = interceptorOptions
      const maxAttempts = await value(
        callOptions.context.retry ?? this.defaultRetry,
        callOptions,
      )

      const retryDelay = callOptions.context.retryDelay ?? this.defaultRetryDelay
      const shouldRetry = callOptions.context.shouldRetry ?? this.defaultShouldRetry
      const onRetry = callOptions.context.onRetry ?? this.defaultOnRetry

      // A stream input is consumed by the first attempt, so it cannot be sent again.
      if (maxAttempts <= 0 || isStream(callOptions.input)) {
        return next(callOptions)
      }

      const pluginContext: PluginContext = { isReplayable: true }
      let lastEventId = callOptions.lastEventId
      let lastEventRetry: undefined | number
      let callback: void | ((isSuccess: boolean) => void)
      let attempt = 1

      const callNext = async (initialError?: { error: unknown }) => {
        let currentError = initialError

        while (true) {
          const updatedCallOptions = { ...callOptions, lastEventId }
          let retryDelayMs = 0

          if (currentError) {
            if (attempt > maxAttempts || !pluginContext.isReplayable) {
              throw currentError.error
            }

            const attemptOptions: RetryLinkPluginAttemptOptions<RetryLinkPluginContext> = {
              ...updatedCallOptions,
              attempt,
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

            retryDelayMs = await value(retryDelay, attemptOptions)
            callback = onRetry?.(attemptOptions)
          }

          try {
            if (currentError) {
              await sleep(retryDelayMs, { signal: updatedCallOptions.signal })

              attempt++
            }

            currentError = undefined
            return await next({
              ...updatedCallOptions,
              context: { ...updatedCallOptions.context, [this.CONTEXT_SYMBOL]: pluginContext },
            })
          }
          catch (error) {
            currentError = { error }

            if (updatedCallOptions.signal?.aborted) {
              throw error
            }
          }
          finally {
            callback?.(!currentError)
            callback = undefined
          }
        }
      }

      const output = await callNext()

      if (!isAsyncIteratorObject(output)) {
        return output
      }

      let current = output
      let isIteratorAborted = false

      return override(() => current, new AsyncIteratorClass(
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

              const asyncIteratorObject = await callNext({ error })
              if (!isAsyncIteratorObject(asyncIteratorObject)) {
                throw new TypeError(
                  'RetryLinkPlugin: Expected an AsyncIteratorObject, got a different type.',
                )
              }

              current = asyncIteratorObject

              if (isIteratorAborted) {
                await current.return?.()
                throw error
              }
            }
          }
        },
        async ({ kind }) => {
          isIteratorAborted = true

          if (kind === 'cancelled') {
            await current.return?.()
          }
        },
      ))
    }

    /**
     * Runs before other transport interceptors, so it sees the body produced by the codec
     * (e.g. an OpenAPI `{ body: stream }` input) rather than one rewritten by another plugin.
     */
    const transportInterceptor: StandardLinkTransportInterceptor<T> = (interceptorOptions) => {
      const pluginContext = interceptorOptions.context[this.CONTEXT_SYMBOL] as PluginContext | undefined

      if (pluginContext && isStream(interceptorOptions.request.body)) {
        pluginContext.isReplayable = false
      }

      return interceptorOptions.next()
    }

    return {
      ...options,
      interceptors: [interceptor, ...toArray(options.interceptors)],
      transportInterceptors: [transportInterceptor, ...toArray(options.transportInterceptors)],
    }
  }
}

function isStream(value: unknown): boolean {
  return value instanceof ReadableStream || isAsyncIteratorObject(value)
}
