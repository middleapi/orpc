import { createORPCClient } from '@orpc/client'
import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { RPCLink } from '@orpc/client/websocket'
import type { RouterClient } from '@orpc/server'
import { createRouterUtils } from '@orpc/tanstack-query'

import type { router } from '../routers'

export interface ClientContext extends RetryLinkPluginContext {}

const link = new RPCLink({
  connect: (info) => new WebSocket(`${location.origin}/ws/rpc`),
  plugins: [new RetryLinkPlugin()],
})

export const client: RouterClient<typeof router, ClientContext> = createORPCClient(link)

export const orpc = createRouterUtils(client)
