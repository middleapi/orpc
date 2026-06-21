import type { Context, ErrorMap, ProcedureClientInterceptor, Schema } from '@orpc/server'
import type { StandardHandlerInterceptor, StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { StandardRequest } from '@standardserver/core'
import type { RequestLogger } from 'evlog'
import type { BaseEvlogOptions, FrameworkIntegrationHelpers, FrameworkIntegrationSpec } from 'evlog/toolkit'
import { wrapEventIteratorPreservingMeta } from '@orpc/client'
import { isAbortError, isAsyncIteratorObject, ORPC_NAME, override, sleep, toArray, wrapReadableStream } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standardserver/core'
import { defineFrameworkIntegration } from 'evlog/toolkit'
import { getLogger, LOGGER_CONTEXT_SYMBOL } from './context'

export interface EvlogHandlerPluginOptions<_T extends Context> extends BaseEvlogOptions {
  /**
   * AsyncLocalStorage instance backing `useLogger()`.
   */
  storage?: FrameworkIntegrationSpec<{ request: StandardRequest }>['storage']

  /**
   * If true, this plugin will log when a request signal is aborted.
   *
   * @default false
   */
  logAbort?: boolean
}

export class EvlogHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~evlog'

  /**
   * - Logging interceptors should run after OpenTelemetry interceptors
   *   so they execute within the active request span.
   * - Logging interceptors should run after batch interceptors
   *   so they log each individual request instead of the batch request.
   */
  before = ['~opentelemetry', '~batch']

  private readonly logAbort: Exclude<EvlogHandlerPluginOptions<T>['logAbort'], undefined>
  private readonly integration: FrameworkIntegrationHelpers<{ request: StandardRequest }>
  private readonly evlogOptions: BaseEvlogOptions

  constructor(
    { storage, logAbort, ...evlogOptions }: EvlogHandlerPluginOptions<T> = {},
  ) {
    this.evlogOptions = evlogOptions
    this.logAbort = logAbort ?? false
    this.integration = defineFrameworkIntegration({
      name: ORPC_NAME,
      storage,
      extractRequest: ({ request }) => {
        const [pathname] = parseStandardUrl(request.url)

        return {
          method: request.method,
          path: pathname,
          headers: request.headers,
          requestId: flattenStandardHeader(request.headers['x-request-id']),
        }
      },
      attachLogger: () => {
        /* logger is manually injected into the oRPC context */
      },
    })
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const { skipped, finish, runWith, logger } = this.integration.start(interceptorOptions, this.evlogOptions)

      if (skipped) {
        return next()
      }

      try {
        const result = await runWith(() => next({
          ...interceptorOptions,
          context: {
            ...interceptorOptions.context,
            [LOGGER_CONTEXT_SYMBOL]: logger,
          },
        }))

        if (result.matched) {
          if (isAsyncIteratorObject(result.response.body)) {
            return {
              ...result,
              response: {
                ...result.response,
                /**
                 * @warning
                 * Remember use `override` for event iterator to remain other special properties
                 */
                body: override(result.response.body, wrapEventIteratorPreservingMeta(result.response.body, {
                  runWith,
                  onError: (error) => {
                    /**
                     * Any error here is internal (interceptor/framework), not business logic.
                     * Indicates unexpected handler failure.
                     */
                    logger.error(toErrorOrString(error))
                  },
                  onFinish: async () => {
                    await sleep(0) // dealing with "log.error() called after the wide event was emitted"
                    await finish({ status: result.response?.status })
                  },
                })),
              },
            }
          }

          if (result.response.body instanceof ReadableStream) {
            return {
              ...result,
              response: {
                ...result.response,
                /**
                 * @warning
                 * Remember use `override` for event iterator to remain other special properties
                 */
                body: override(result.response.body, wrapReadableStream(result.response.body, {
                  runWith,
                  onError: (error) => {
                    /**
                     * Any error here is internal (interceptor/framework), not business logic.
                     * Indicates unexpected handler failure.
                     */
                    logger.error(toErrorOrString(error))
                  },
                  onFinish: async () => {
                    await sleep(0) // dealing with "log.error() called after the wide event was emitted"
                    await finish({ status: result.response?.status })
                  },
                })),
              },
            }
          }
        }
        else {
          logger.set({ message: 'No procedure matched' })
        }

        await finish({ status: result.response?.status })

        return result
      }
      catch (error) {
        /**
         * Any error here is internal (interceptor/framework), not business logic.
         * Indicates unexpected handler failure.
         */
        logger.error(toErrorOrString(error))
        await finish()
        throw error
      }
    }

    const interceptor: StandardHandlerInterceptor<T> = async ({ next, context, path, request }) => {
      const logger = getLogger(context)
      logger?.set({ rpc: { system: ORPC_NAME, method: path.join('.') } })

      if (this.logAbort) {
        const signal = request.signal

        if (signal?.aborted) {
          logger?.set({
            abort: {
              message: `request was aborted before handling`,
              reason: String(signal.reason),
            },
          })
        }
        else {
          signal?.addEventListener('abort', () => {
            logger?.set({
              abort: {
                reason: String(signal.reason),
                abortedAt: new Date().toISOString(),
              },
            })
          }, { once: true })
        }
      }

      try {
        return await next()
      }
      catch (error) {
        logBusinessLogicError(logger, error)
        throw error
      }
    }

    const clientInterceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap, any> = async ({ next, context }) => {
      const logger = getLogger(context)
      const output = await next()

      if (isAsyncIteratorObject(output)) {
        /**
         * @warning
         * Remember use `override` for event iterator to remain other special properties
         */
        return override(output, wrapEventIteratorPreservingMeta(output, {
          onError: (error) => {
            logBusinessLogicError(logger, error)
          },
        }))
      }

      if (output instanceof ReadableStream) {
        /**
         * @warning
         * Remember use `override` for event iterator to remain other special properties
         */
        return override(output, wrapReadableStream(output, {
          onError: (error) => {
            logBusinessLogicError(logger, error)
          },
        }))
      }

      return output
    }

    return {
      ...options,
      routingInterceptors: [
        routingInterceptor,
        ...toArray(options.routingInterceptors),
      ],
      interceptors: [
        interceptor,
        ...toArray(options.interceptors),
      ],
      clientInterceptors: [
        clientInterceptor,
        ...toArray(options.clientInterceptors),
      ],
    }
  }
}

function toErrorOrString(error: unknown) {
  if (error instanceof Error) {
    return error
  }

  return String(error)
}

function logBusinessLogicError(logger: RequestLogger | undefined, error: unknown) {
  logger?.error(toErrorOrString(error))

  // DO NOT treat aborted error as error if happen during business logic
  if (isAbortError(error)) {
    logger?.setLevel('info')
  }
}
