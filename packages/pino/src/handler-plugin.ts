import type { Context, ErrorMap, ProcedureClientInterceptor, Schema } from '@orpc/server'
import type { StandardHandlerInterceptor, StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Logger } from 'pino'
import type { LoggerContext } from './context'
import { wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import { isAbortError, isAsyncIteratorObject, ORPC_NAME, override, toArray, wrapReadableStream } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'
import pino from 'pino'
import { getLogger, LOGGER_CONTEXT_SYMBOL } from './context'

export interface PinoHandlerPluginOptions<T extends Context> {
  /**
   * Logger instance to use for logging.
   *
   * @default pino()
   */
  logger?: Logger

  /**
   * Function to generate a unique ID for each request.
   *
   * @default ({ request }) => flattenStandardHeader(request.headers['x-request-id']) ?? crypto.randomUUID()
   */
  generateRequestId?: (options: StandardHandlerRoutingInterceptorOptions<T>) => string

  /**
   * If true, this plugin will log information about request lifecycle,
   * including when a request is received, handled, or no matching procedure is found.
   *
   * @default false
   */
  logLifecycle?: boolean

  /**
   * If true, this plugin will log when a request signal is aborted.
   *
   * @default false
   */
  logAbort?: boolean
}

export class PinoHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~pino'

  /**
   * - Logging interceptors should run after OpenTelemetry interceptors
   *   so they execute within the active request span.
   * - Logging interceptors should run after batch interceptors
   *   so they log each individual request instead of the batch request.
   */
  before = ['~opentelemetry', '~batch']

  private readonly logger: Exclude<PinoHandlerPluginOptions<T>['logger'], undefined>
  private readonly generateRequestId: Exclude<PinoHandlerPluginOptions<T>['generateRequestId'], undefined>
  private readonly logLifecycle: Exclude<PinoHandlerPluginOptions<T>['logLifecycle'], undefined>
  private readonly logAbort: Exclude<PinoHandlerPluginOptions<T>['logAbort'], undefined>

  constructor(
    options: PinoHandlerPluginOptions<T> = {},
  ) {
    this.logger = options.logger ?? pino()
    this.generateRequestId = options.generateRequestId
      ?? (({ request }) => flattenStandardHeader(request.headers['x-request-id']) ?? crypto.randomUUID())
    this.logLifecycle = options.logLifecycle ?? false
    this.logAbort = options.logAbort ?? false
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const startMs = Date.now()

      const logger = (
        (interceptorOptions.context as LoggerContext)[LOGGER_CONTEXT_SYMBOL] ?? this.logger
      ).child({})

      /**
       * pino-http might have already set req info in bindings
       */
      if (!logger.bindings().req) {
        logger.setBindings({
          req: {
            id: this.generateRequestId(interceptorOptions),
            url: interceptorOptions.request.url,
            method: interceptorOptions.request.method,
            headers: {
              'content-type': interceptorOptions.request.headers['content-type'],
              'content-length': interceptorOptions.request.headers['content-length'],
              'content-disposition': interceptorOptions.request.headers['content-disposition'],
              'standard-server': interceptorOptions.request.headers['standard-server'],
            },
          },
        })
      }

      try {
        if (this.logLifecycle) {
          logger?.info('request received')
        }

        const result = await next({
          ...interceptorOptions,
          context: {
            ...interceptorOptions.context,
            [LOGGER_CONTEXT_SYMBOL]: logger,
          },
        })

        if (this.logLifecycle) {
          if (result.matched) {
            logger?.info({
              msg: 'request handled',
              res: {
                status: result.response.status,
              },
              responseTime: Date.now() - startMs,
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
    }

    const interceptor: StandardHandlerInterceptor<T> = async ({ next, context, path, request }) => {
      const logger = getLogger(context)
      logger?.setBindings({ rpc: { system: ORPC_NAME, method: path.join('.') } })

      if (this.logAbort) {
        const signal = request.signal

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
        return await next()
      }
      catch (error) {
        logBusinessLogicError(logger, error)
        throw error
      }
    }

    const clientInterceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap, any> = async ({ next, context }) => {
      const output = await next()

      if (isAsyncIteratorObject(output)) {
        /**
         * @warning
         * Remember use `override` for event iterator to remain other special properties
         */
        return override(output, wrapAsyncIteratorPreservingEventMeta(output, {
          onError: (error) => {
            logBusinessLogicError(getLogger(context), error)
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
            logBusinessLogicError(getLogger(context), error)
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

function logBusinessLogicError(logger: Logger | undefined, error: unknown) {
  // DO NOT treat aborted error as error if happen during business logic
  if (isAbortError(error)) {
    logger?.info(error)
  }
  else {
    logger?.error(error)
  }
}
