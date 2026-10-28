import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardUrl } from '@standard-server/core'
import type { OpenRPCDocument } from '../types'
import { matchesHttpPath, mergeHttpPath, toArray, value } from '@orpc/shared'
import { getJsonRpcCall } from '../adapters/standard/utils'

export interface OpenRPCDiscoveryHandlerPluginOptions<T extends Context> {
  /**
   * The document to serve, for example a memoized `() => generator.generate(router)`.
   */
  spec: Value<Promisable<OpenRPCDocument>, [options: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * The path (relative to the prefix) at which to also serve the document over `GET`, or `false` to disable it.
   *
   * @default '/openrpc.json'
   */
  specPath?: StandardUrl | false | undefined
}

/**
 * Answers the OpenRPC Service Discovery method `rpc.discover` with the document, and serves it over `GET`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#service-discovery | OpenRPC Specification - Service Discovery}
 */
export class OpenRPCDiscoveryHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~openrpc-discovery'

  private readonly spec: OpenRPCDiscoveryHandlerPluginOptions<T>['spec']
  private readonly specPath: Exclude<OpenRPCDiscoveryHandlerPluginOptions<T>['specPath'], undefined>

  constructor(options: OpenRPCDiscoveryHandlerPluginOptions<T>) {
    this.spec = options.spec
    this.specPath = options.specPath ?? '/openrpc.json'
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      routingInterceptors: [
        ...toArray(options.routingInterceptors),
        async ({ next, ...interceptorOptions }) => {
          const { request, prefix } = interceptorOptions

          // only `OpenRPCHandler` creates JSON-RPC calls
          if (getJsonRpcCall(request)?.method === 'rpc.discover') {
            return { matched: true, response: { status: 200, headers: {}, body: { result: await value(this.spec, interceptorOptions) } } }
          }

          const result = await next()

          if (
            result.matched
            || request.method !== 'GET'
            || this.specPath === false
            || !matchesHttpPath(request.url, prefix ? mergeHttpPath(prefix, this.specPath) : this.specPath)
          ) {
            return result
          }

          return { matched: true, response: { status: 200, headers: {}, body: await value(this.spec, interceptorOptions) } }
        },
      ],
    }
  }
}
