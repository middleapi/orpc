import type {
  AnyProcedure,
  Context,
  ErrorMap,
  ProcedureClientInterceptor,
  Schema,
} from '@orpc/server'
import { Procedure } from '@orpc/server'
import type {
  StandardHandlerOptions,
  StandardHandlerPlugin,
  StandardHandlerRoutingInterceptor,
} from '@orpc/server/standard'
import { isAsyncIteratorObject, toArray } from '@orpc/shared'
import { HibernationAsyncIteratorClass } from '@standard-server/peer'

interface PluginContext {
  hibernation?: HibernationAsyncIteratorClass<any>
}

/**
 * A handler plugin that enables the Hibernation APIs, allowing procedures
 * to return a `HibernationAsyncIteratorClass` for hibernation-friendly
 * event streaming.
 *
 * @see {@link https://orpc.dev/docs/integrations/hibernation | Hibernation Integration}
 */
export class HibernationHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  readonly name = '~hibernation'

  /**
   * Must wrap every routing interceptor that replaces async iterator response bodies.
   */
  readonly after: readonly string[] = ['~tracing']

  /**
   * Runs inside batch.
   */
  readonly before: readonly string[] = ['~batch']

  private readonly CONTEXT_SYMBOL = Symbol('ORPC_HIBERNATION_HANDLER_PLUGIN_CONTEXT')

  private readonly procedures = new WeakMap<AnyProcedure, AnyProcedure>()

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (options) => {
      const pluginContext: PluginContext = {}

      const result = await options.next({
        ...options,
        context: {
          ...options.context,
          [this.CONTEXT_SYMBOL]: pluginContext,
        },
      })

      const hibernation = pluginContext.hibernation
      const body = result.response?.body

      if (!result.matched || !hibernation || !isAsyncIteratorObject(body)) {
        return result
      }

      /**
       * Everything between the handler and here (output validation, the codec,
       * other plugins) wraps async iterators, which loses the
       * `HibernationAsyncIteratorClass` identity the peer relies on.
       * Respond with a new one that also returns the wrapped body,
       * so those wrappers can still clean up once the peer is done with it.
       */
      const responseBody = new HibernationAsyncIteratorClass<unknown>((id) =>
        hibernation['~callback']?.(id),
      )
      const returnResponseBody = responseBody.return.bind(responseBody)

      responseBody.return = async (...args) => {
        await body.return?.()
        return returnResponseBody(...args)
      }

      return { ...result, response: { ...result.response, body: responseBody } }
    }

    const clientInterceptor: ProcedureClientInterceptor<T, Schema<unknown>, ErrorMap> = async (
      options,
    ) => {
      if (!options.context[this.CONTEXT_SYMBOL]) {
        throw new TypeError(
          '[HibernationHandlerPlugin] Hibernation context has been corrupted or modified by another plugin or interceptor',
        )
      }

      let procedure = this.procedures.get(options.procedure)

      if (!procedure) {
        procedure = this.wrapProcedure(options.procedure)
        this.procedures.set(options.procedure, procedure)
      }

      return await options.next({ ...options, procedure })
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
      clientInterceptors: [...toArray(options.clientInterceptors), clientInterceptor],
    }
  }

  /**
   * Catches the iterator right where the handler returns it,
   * before output validation or anything else can wrap it.
   */
  private wrapProcedure(procedure: AnyProcedure): AnyProcedure {
    const definition = procedure['~orpc']

    return new Procedure({
      ...definition,
      handler: async (options, input) => {
        const output = await definition.handler(options, input)

        if (output instanceof HibernationAsyncIteratorClass) {
          ;(options.context[this.CONTEXT_SYMBOL] as PluginContext).hibernation = output
        }

        return output
      },
    })
  }
}
