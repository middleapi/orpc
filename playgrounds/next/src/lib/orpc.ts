import type { router } from '@/routers'
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createRouterUtils, StreamQuerySSRUtilsPlugin } from '@orpc/tanstack-query'
import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import { BatchLinkPlugin, RetryLinkPlugin } from '@orpc/client/plugins'

export interface ClientContext extends RetryLinkPluginContext {}

if (import.meta.env.SSR) {
  await import('./orpc.server')
}

declare global {
  /**
   * The SSR client registered by `orpc.server.ts`, calling procedures in-process instead of over HTTP.
   *
   * @see {@link https://orpc.dev/docs/recipes/optimizing-ssr | Optimizing SSR}
   */
  var $client: RouterClient<typeof router, ClientContext> | undefined
}

const link = new RPCLink({
  origin: typeof window !== 'undefined' ? undefined : 'http://localhost:3000',
  url: '/rpc',
  plugins: [
    new BatchLinkPlugin({
      groups: [{
        condition: () => true,
        context: {},
      }],
    }),
    new RetryLinkPlugin(),
  ],
  headers: async () => {
    if (typeof window !== 'undefined') {
      return {}
    }

    const { headers } = await import('next/headers')
    return await headers()
  },
})

/**
 * Fall back to a browser client when no SSR client is registered.
 */
export const client: RouterClient<typeof router, ClientContext> = globalThis.$client ?? createORPCClient(link)

export const orpc = createRouterUtils(client, {
  plugins: [new StreamQuerySSRUtilsPlugin()],
})
