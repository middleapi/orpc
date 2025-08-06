import type { StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
/**
 * @module
 * Context Storage Plugin for oRPC.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const asyncLocalStorage = new AsyncLocalStorage<Context>()

/**
 * Context Storage Plugin for oRPC.
 *
 * This plugin stores the oRPC Context in AsyncLocalStorage, making it globally accessible
 * within the request scope. Similar to Hono's context-storage middleware.
 *
 * @see {@link https://orpc.unnoq.com/docs/plugins/context-storage Context Storage Plugin Docs}
 *
 * @example
 * ```ts
 * import { os } from '@orpc/server'
 * import { ContextStoragePlugin, getContext } from '@orpc/server'
 *
 * const router = os.router({
 *   ping: os.procedure
 *     .handler(() => {
 *       // You can access context anywhere in the request scope
 *       const ctx = getContext()
 *       return 'pong'
 *     })
 * })
 *
 * const handler = new FetchHandler(router, {
 *   plugins: [new ContextStoragePlugin()]
 * })
 * ```
 */
export class ContextStoragePlugin<T extends Context> implements StandardHandlerPlugin<T> {
  order = 1_000_000 // High priority to ensure context is available early

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    // Add interceptor at the beginning to ensure context is available for all subsequent interceptors
    options.rootInterceptors.unshift(async (interceptorOptions) => {
      // Store the context in AsyncLocalStorage and run the next interceptor
      return asyncLocalStorage.run(interceptorOptions.context, interceptorOptions.next)
    })
  }
}

/**
 * Get the current oRPC Context from AsyncLocalStorage.
 *
 * This function can be called anywhere within the request scope when the
 * ContextStoragePlugin is enabled.
 *
 * @returns The current oRPC Context
 * @throws {Error} When context is not available (ContextStoragePlugin not enabled or called outside request scope)
 *
 * @example
 * ```ts
 * import { getContext } from '@orpc/server'
 *
 * function someUtilityFunction() {
 *   const context = getContext()
 *   // Use context properties here
 *   return context.userId
 * }
 * ```
 */
export function getContext<T extends Context = Context>(): T {
  const context = asyncLocalStorage.getStore()
  if (!context) {
    throw new Error(
      'Context is not available. Make sure ContextStoragePlugin is enabled and this function is called within a request scope.',
    )
  }
  return context as T
}
