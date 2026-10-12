import type { AnyProcedure, Context, ErrorMap, ProcedureClientInterceptor, Schema } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import { Procedure } from '@orpc/server'
import { isAsyncIteratorObject, toArray } from '@orpc/shared'
import { HibernationAsyncIteratorClass } from '@standard-server/peer'

interface HibernationPluginContext {
  hibernation?: HibernationAsyncIteratorClass<any>
  /**
   * The iterator returned by the procedure handler, recorded before output
   * validation wraps it.
   */
  handlerHibernation?: HibernationAsyncIteratorClass<any>
}

/**
 * A handler plugin that enables the Hibernation APIs, allowing procedures
 * to return a `HibernationAsyncIteratorClass` for hibernation-friendly
 * event streaming.
 *
 * @see {@link https://orpc.dev/docs/integrations/hibernation | Hibernation Integration}
 */
export class HibernationHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~hibernation'

  before = ['~batch']

  private readonly CONTEXT_SYMBOL = Symbol('ORPC_HIBERNATION_HANDLER_PLUGIN_CONTEXT')

  private readonly recordingProcedures = new WeakMap<AnyProcedure, AnyProcedure>()

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (options) => {
      const pluginContext: HibernationPluginContext = {}

      const result = await options.next({
        ...options,
        context: {
          ...options.context,
          [this.CONTEXT_SYMBOL]: pluginContext,
        },
      })

      if (!result.matched || !pluginContext.hibernation) {
        return result
      }

      /**
       * The codec serializes async iterator outputs by wrapping them,
       * which loses the `HibernationAsyncIteratorClass` identity the peer
       * relies on. Restore the original iterator as the response body.
       */
      return {
        ...result,
        response: {
          ...result.response,
          body: pluginContext.hibernation,
        },
      }
    }

    const clientInterceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap> = async (options) => {
      const pluginContext = options.context[this.CONTEXT_SYMBOL] as HibernationPluginContext | undefined

      if (!pluginContext) {
        throw new TypeError('[HibernationHandlerPlugin] Hibernation context has been corrupted or modified by another plugin or interceptor')
      }

      const output = await options.next({
        ...options,
        procedure: this.getRecordingProcedure(options.procedure),
      })

      if (output instanceof HibernationAsyncIteratorClass) {
        pluginContext.hibernation = output
        return undefined
      }

      /**
       * Output schemas like `asyncIteratorObject` wrap the iterator in a new
       * `AsyncIteratorClass`, hiding the one returned by the handler.
       * The wrapper has not been started yet, so it can be dropped as is.
       */
      if (pluginContext.handlerHibernation && isAsyncIteratorObject(output)) {
        pluginContext.hibernation = pluginContext.handlerHibernation
        return undefined
      }

      return output
    }

    return {
      ...options,
      routingInterceptors: [
        routingInterceptor,
        ...toArray(options.routingInterceptors),
      ],
      clientInterceptors: [
        ...toArray(options.clientInterceptors),
        clientInterceptor,
      ],
    }
  }

  /**
   * Returns a copy of the procedure whose handler records a returned
   * `HibernationAsyncIteratorClass` in the plugin context before output
   * validation runs.
   */
  private getRecordingProcedure(procedure: AnyProcedure): AnyProcedure {
    let recording = this.recordingProcedures.get(procedure)

    if (!recording) {
      const handler = procedure['~orpc'].handler

      recording = new Procedure({
        ...procedure['~orpc'],
        handler: async (opts, input) => {
          const output = await handler(opts, input)

          if (output instanceof HibernationAsyncIteratorClass) {
            const pluginContext = opts.context[this.CONTEXT_SYMBOL] as HibernationPluginContext | undefined

            if (pluginContext) {
              pluginContext.handlerHibernation = output
            }
          }

          return output
        },
      })

      this.recordingProcedures.set(procedure, recording)
    }

    return recording
  }
}
