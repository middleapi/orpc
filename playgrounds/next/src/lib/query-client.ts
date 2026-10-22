import { environmentManager, QueryClient } from '@tanstack/react-query'
import { RPCJsonSerializer } from '@orpc/client'
import { createHydrationOptions, createQueryKeyHashFn } from '@orpc/tanstack-query'

let browserQueryClient: QueryClient | undefined

/**
 * Returns the query client for the current environment: a fresh one per
 * request on the server, a shared singleton in the browser.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#server-side-rendering-ssr | TanStack Query Integration - Server-Side Rendering (SSR)}
 */
export function getQueryClient(): QueryClient {
  if (environmentManager.isServer()) {
    return createQueryClient()
  }

  browserQueryClient ??= createQueryClient()
  return browserQueryClient
}

const serializer = new RPCJsonSerializer({
  handlers: {
    // put custom serializers here
  },
})

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // > 0 to prevent immediate refetching on mount
        queryKeyHashFn: createQueryKeyHashFn(serializer),
      },
      ...createHydrationOptions(serializer),
    },
  })
}
