import type { Context, ErrorMap, ProcedureClientInterceptor, Schema } from '@orpc/server'
import type { StandardHandlerInterceptor, StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Logger } from 'pino'
import type { LoggerContext } from './context'
import { cloneORPCError, ORPCError, wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import { ValidationError } from '@orpc/server'
import { isAbortError, isAsyncIteratorObject, ORPC_NAME, override, toArray, wrapReadableStream } from '@orpc/shared'
import { flattenStandardHeader } from '@standard-server/core'
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

  /**
   * Customizes the log level for errors thrown from procedures;
   * internal handler failures are always logged at error level.
   * Receives the level applied by default; return it to keep the default behavior:
   * 'info' for abort errors, 'warn' for ORPCError except INTERNAL_SERVER_ERROR, 'error' otherwise.
   *
   * @default (error, level) => level
   */
  procedureErrorLevel?: (error: unknown, level: pino.Level) => pino.Level
}

/**
 * Instruments an oRPC handler with Pino structured logging, request tracking,
 * and error monitoring.
 *
 * @see {@link https://orpc.dev/docs/integrations/pino | Pino Integration}
 */
export class PinoHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~pino'

  /**
   * - Logging interceptors should run after tracing interceptors
   *   so they execute within the active request span.
   * - Logging interceptors should run after batch interceptors
   *   so they log each individual request instead of the batch request.
   */
  before = ['~tracing', '~batch', '~hibernation']

  private readonly logger: Exclude<PinoHandlerPluginOptions<T>['logger'], undefined>
  private readonly generateRequestId: Exclude<PinoHandlerPluginOptions<T>['generateRequestId'], undefined>
  private readonly logLifecycle: Exclude<PinoHandlerPluginOptions<T>['logLifecycle'], undefined>
  private readonly logAbort: Exclude<PinoHandlerPluginOptions<T>['logAbort'], undefined>
  private readonly procedureErrorLevel: Exclude<PinoHandlerPluginOptions<T>['procedureErrorLevel'], undefined>

  constructor(
    options: PinoHandlerPluginOptions<T> = {},
  ) {
    this.logger = options.logger ?? pino()
    this.generateRequestId = options.generateRequestId
      ?? (({ request }) => flattenStandardHeader(request.headers['x-request-id']) ?? crypto.randomUUID())
    this.logLifecycle = options.logLifecycle ?? false
    this.logAbort = options.logAbort ?? false
    this.procedureErrorLevel = options.procedureErrorLevel ?? ((_, level) => level)
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
        logProcedureError(logger, error, this.procedureErrorLevel)
        throw error
      }
    }

    const clientInterceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap> = async ({ next, context }) => {
      const output = await next()

      if (isAsyncIteratorObject(output)) {
        /**
         * @remarks
         * **Warning**: Remember use `override` for AsyncIteratorObject to remain other special properties
         */
        return override(output, wrapAsyncIteratorPreservingEventMeta(output, {
          onError: (error) => {
            logProcedureError(getLogger(context), error, this.procedureErrorLevel)
          },
        }))
      }

      if (output instanceof ReadableStream) {
        /**
         * @remarks
         * **Warning**: Remember use `override` for ReadableStream to remain other special properties
         */
        return override(output, wrapReadableStream(output, {
          onError: (error) => {
            logProcedureError(getLogger(context), error, this.procedureErrorLevel)
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

function logProcedureError(
  logger: Logger | undefined,
  error: unknown,
  procedureErrorLevel: Exclude<PinoHandlerPluginOptions<any>['procedureErrorLevel'], undefined>,
) {
  logger?.[procedureErrorLevel(error, defaultProcedureErrorLevel(error))](toLoggableError(error))
}

/**
 * Validation errors can carry the raw input or output, in `ValidationError.invalidData`
 * and in the issues themselves (Valibot and ArkType attach the parent object to them),
 * so only the message and path of each issue are kept.
 *
 * An ORPCError is a rejection delivered to the client, so it is reduced to its code, message,
 * `defined` and the issues of the validation error it wraps: its `data` and `cause` are dropped.
 * INTERNAL_SERVER_ERROR and non-ORPC errors are internal failures and keep their full details,
 * except that a validation error in the cause of an INTERNAL_SERVER_ERROR
 * (as thrown when output validation fails) is still reduced.
 */
function toLoggableError(error: unknown): unknown {
  if (error instanceof ValidationError) {
    return copyError(error, { issues: toLoggableIssues(error.issues) })
  }

  if (!(error instanceof ORPCError)) {
    return error
  }

  if (error.code === 'INTERNAL_SERVER_ERROR') {
    const cause = toLoggableError(error.cause)

    if (cause === error.cause) {
      return error
    }

    const cloned = cloneORPCError(error)
    cloned.cause = cause
    return cloned
  }

  const issues = findValidationError(error.cause)?.issues

  return copyError(error, {
    code: error.code,
    defined: error.defined,
    ...(issues && { issues: toLoggableIssues(issues) }),
  })
}

/**
 * Copies an error with its class, name, message and stack, and `fields` as its only other properties.
 */
function copyError(error: Error, fields: Record<string, unknown>): Error {
  const copy: Error = Object.create(Object.getPrototypeOf(error), {
    message: { value: error.message, writable: true, configurable: true },
    stack: { value: error.stack, writable: true, configurable: true },
  })

  return Object.assign(copy, { name: error.name }, fields)
}

function findValidationError(error: unknown): ValidationError | undefined {
  const seen = new Set<unknown>()

  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    if (current instanceof ValidationError) {
      return current
    }

    seen.add(current)
  }

  return undefined
}

function toLoggableIssues(issues: ValidationError['issues']) {
  return issues.map(issue => ({
    message: issue.message,
    path: issue.path?.map((segment) => {
      const key: unknown = typeof segment === 'object' ? segment.key : segment

      // Valibot map and set path items can hold any value as key
      return typeof key === 'string' || typeof key === 'number' || typeof key === 'symbol' ? key : `[${typeof key}]`
    }),
  }))
}

function defaultProcedureErrorLevel(error: unknown): pino.Level {
  // An abort means the client withdrew the request, not that something failed,
  // so record it as normal operation.
  if (isAbortError(error)) {
    return 'info'
  }

  // A thrown ORPCError is a deliberate business rejection delivered to the client,
  // so keep it reviewable without treating it as a failure. INTERNAL_SERVER_ERROR
  // is the exception: it signals a server-side failure (oRPC itself throws it for
  // failures like output validation), so it stays at error level along with
  // anything unexpected.
  if (error instanceof ORPCError && error.code !== 'INTERNAL_SERVER_ERROR') {
    return 'warn'
  }

  return 'error'
}
