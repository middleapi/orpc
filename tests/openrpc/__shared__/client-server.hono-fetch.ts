import type { AddressInfo } from 'node:net'
import type { CreateOpenRPCClientServerTest } from './client-server'
import { serve } from '@hono/node-server'
import { createORPCClient } from '@orpc/client'
import { OpenRPCHandler, OpenRPCLink } from '@orpc/openrpc/fetch'

export const createHonoFetchClientServerTest: CreateOpenRPCClientServerTest = (
  router,
  { context = {}, serializer, handlerPlugins, linkPlugins } = {},
) => {
  const handler = new OpenRPCHandler(router, {
    serializer,
    plugins: handlerPlugins,
  })

  const server = serve({
    fetch: async (request: Request) => {
      const { response } = await handler.handle(request, {
        context,
        prefix: '/rpc',
      })

      return response ?? new Response('Not Found', { status: 404 })
    },
    port: 0,
  })

  afterAll(() => {
    server.close()
  })

  const addressInfo = server.address() as AddressInfo

  const link = new OpenRPCLink({
    url: '/rpc',
    origin: `http://localhost:${addressInfo.port}`,
    serializer,
    plugins: linkPlugins,
    fetch(url, init) {
      return fetch(url, init)
    },
  })

  return createORPCClient(link)
}
