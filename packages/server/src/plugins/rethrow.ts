import type { ThrowableError, Value } from '@orpc/shared'
import type { StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import { value } from '@orpc/shared'

export interface experimental_RethrowHandlerPluginOptions<T extends Context> {
  /**
   * Decide which errors should be rethrown.
   *
   * @example
   * ```ts
   * const rethrowPlugin = new RethrowHandlerPlugin({
   *   filter: (error) => {
   *     // Rethrow all non-ORPCError errors
   *     return !(error instanceof ORPCError)
   *   }
   * })
   * ```
   */
  filter: Value<boolean, [error: ThrowableError, options: StandardHandlerInterceptorOptions<T>]>
}

interface RethrowHandlerPluginContext {
  error?: { value: ThrowableError }
}

/**
 * The plugin allows you to catch and rethrow specific errors that occur during request handling.
 * This is particularly useful when your framework has its own error handling mechanism
 * (e.g., global exception filters in NestJS, error middleware in Express)
 * and you want certain errors to be processed by that mechanism instead of being handled by the
 * oRPC error handling flow.
 *
 * @see {@link https://orpc.dev/docs/plugins/rethrow-handler Rethrow Handler Plugin Docs}
 */
export class experimental_RethrowHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly filter: experimental_RethrowHandlerPluginOptions<T>['filter']

  CONTEXT_SYMBOL = Symbol('ORPC_RETHROW_HANDLER_PLUGIN_CONTEXT')

  constructor(options: experimental_RethrowHandlerPluginOptions<T>) {
    this.filter = options.filter
  }

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []
    options.interceptors ??= []

    options.rootInterceptors.push(async (options) => {
      const pluginContext: RethrowHandlerPluginContext = {}

      const result = await options.next({
        ...options,
        context: {
          ...options.context,
          [this.CONTEXT_SYMBOL]: pluginContext,
        },
      })

      if (pluginContext.error) {
        throw pluginContext.error.value
      }

      return result
    })

    options.interceptors.unshift(async (options) => {
      const pluginContext = options.context[this.CONTEXT_SYMBOL] as RethrowHandlerPluginContext | undefined

      if (!pluginContext) {
        throw new TypeError('[RethrowHandlerPlugin] Rethrow handler context has been corrupted or modified by another plugin or interceptor')
      }

      try {
        // await is important here to catch both sync and async errors
        return await options.next()
      }
      catch (error) {
        if (value(this.filter, error as ThrowableError, options)) {
          pluginContext.error = { value: error as ThrowableError }
          return { matched: false, response: undefined }
        }

        throw error
      }
    })
  }
}
