import { afterAll } from 'bun:test'

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RPCHandler } from '@orpc/server/fetch'

import type { CreateClientServerTest } from './client-server.ts'
import { defaultSerializer } from './client-server.ts'

export const createBunFetchClientServerTest: CreateClientServerTest = (
  router,
  { context = {}, serializer = defaultSerializer } = {},
) => {
  const handler = new RPCHandler(router, {
    serializer,
  })

  const server = Bun.serve({
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
    void server.stop()
  })

  const link = new RPCLink({
    url: '/rpc',
    origin: `http://localhost:${server.port}`,
    serializer,
    fetch(url, init) {
      return fetch(url, init)
    },
  })

  return createORPCClient(link)
}
