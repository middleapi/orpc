import type { RouterClient } from '@orpc/server'
import type { router } from '../../server/routers'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { BatchLinkPlugin } from '@orpc/client/plugins'

export default defineNuxtPlugin(() => {
  const link = new RPCLink({
    url: `${window.location.origin}/rpc`,
    headers: () => ({}),
    plugins: [
      new BatchLinkPlugin({
        exclude: ({ path }) => path[0] === 'sse',
        groups: [{
          condition: () => true,
          context: {},
        }],
      }),
    ],
  })

  const client: RouterClient<typeof router> = createORPCClient(link)

  const orpc = createTanstackQueryUtils(client)

  return {
    provide: {
      orpc,
    },
  }
})
