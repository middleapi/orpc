import type { Context } from '@orpc/server'
import type { StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { Logger } from 'pino'
import type { LoggerContext } from './context'
import { mapEventIterator } from '@orpc/client'
import { isAsyncIteratorObject, overlayProxy } from '@orpc/shared'
import pino from 'pino'
import { CONTEXT_LOGGER_SYMBOL, getLogger } from './context'

export interface LoggingHandlerPluginOptions<T extends Context> {
  /**
   * Logger instance to use for logging.
   *
   * @default pino()
   */
  logger?: Logger

  /**
   * Function to generate a unique ID for each request.
   *
   * @default () => crypto.randomUUID()
   */
  generateId?: (options: StandardHandlerInterceptorOptions<T>) => string

  /**
   * Enables logging for request/response events.
   *
   * @example
   * - request received
   * - request handled
   * - no matching procedure found
   *
   * @default false
   */
  logRequestResponse?: boolean

  /**
   * Enables logging when requests are aborted.
   *
   * @example
   * - request is aborted (reason)
   *
   * @remarks If a signal is used for multiple requests, this may lead to un-efficient memory usage (listeners never removed).
   *
   * @default false
   */
  logRequestAbort?: boolean
}

export class LoggingHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly logger: Exclude<LoggingHandlerPluginOptions<T>['logger'], undefined>
  private readonly generateId: Exclude<LoggingHandlerPluginOptions<T>['generateId'], undefined>
  private readonly logRequestResponse: Exclude<LoggingHandlerPluginOptions<T>['logRequestResponse'], undefined>
  private readonly logRequestAbort: Exclude<LoggingHandlerPluginOptions<T>['logRequestAbort'], undefined>

  constructor(
    options: LoggingHandlerPluginOptions<T> = {},
  ) {
    this.logger = options.logger ?? pino()
    this.generateId = options.generateId ?? (() => crypto.randomUUID())
    this.logRequestResponse = options.logRequestResponse ?? false
    this.logRequestAbort = options.logRequestAbort ?? false
  }

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []
    options.interceptors ??= []
    options.clientInterceptors ??= []

    options.rootInterceptors.unshift(async (interceptorOptions) => {
      const logger = (
        (interceptorOptions.context as LoggerContext)[CONTEXT_LOGGER_SYMBOL] ?? this.logger
      ).child({
        orpc: { id: this.generateId(interceptorOptions) },
      })

      /**
       * pino-http might have already set req info in bindings
       */
      if (!logger.bindings().req) {
        logger.setBindings({
          req: {
            url: interceptorOptions.request.url,
            method: interceptorOptions.request.method,
            headers: {
              'content-type': interceptorOptions.request.headers['content-type'],
              'content-length': interceptorOptions.request.headers['content-length'],
              'content-disposition': interceptorOptions.request.headers['content-disposition'],
            },
          },
        })
      }

      if (this.logRequestAbort) {
        const signal = interceptorOptions.request.signal

        if (signal?.aborted) {
          logger?.info(`request was aborted before handling (${String(signal.reason)})`)
        }
        else {
          signal?.addEventListener('abort', () => {
            logger?.info(`request is aborted (${String(signal.reason)})`)
          }, { once: true })
        }
      }

      try {
        if (this.logRequestResponse) {
          logger?.info('request received')
        }

        const result = await interceptorOptions.next({
          ...interceptorOptions,
          context: {
            ...interceptorOptions.context,
            [CONTEXT_LOGGER_SYMBOL]: logger,
          },
        })

        if (this.logRequestResponse) {
          if (result.matched) {
            logger?.info({
              msg: 'request handled',
              res: {
                status: result.response.status,
              },
            })
          }
          else {
            logger?.info('no matching procedure found')
          }
        }

        return result
      }
      catch (error) {
        /**
         * Any error here is internal (interceptor/framework), not business logic.
         * Indicates unexpected handler failure.
         */
        logger.error(error)
        throw error
      }
    })

    options.interceptors.unshift(async ({ next, context, request }) => {
      try {
        return await next()
      }
      catch (error) {
        const logger = getLogger(context)

        /**
         * DON'T treat aborted signal as error if happen during business logic
         */
        if (request.signal?.aborted && request.signal.reason === error) {
          logger?.info(error)
        }
        else {
          logger?.error(error)
        }
        throw error
      }
    })

    options.clientInterceptors.unshift(async ({ next, path, context, signal }) => {
      const logger = getLogger(context)
      logger?.setBindings({ orpc: { ...logger.bindings().orpc, path } })

      const output = await next()

      if (isAsyncIteratorObject(output)) {
        return overlayProxy(output, mapEventIterator(
          output,
          {
            value: v => v,
            error: async (error) => {
              /**
               * DON'T treat aborted signal as error if happen during business logic,
               * Because this is streaming response, so the error can't catch by `interceptors` above.
               */
              if (signal?.aborted && signal.reason === error) {
                logger?.info(error)
              }
              else {
                logger?.error(error)
              }
              return error
            },
          },
        ))
      }

      return output
    })
  }
}
