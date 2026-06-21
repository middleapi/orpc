import type { AddressInfo } from 'node:net'
import type { CreateBatchClientServerTest } from './client-server'
import { serve } from '@hono/node-server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'
import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin } from '@orpc/server/plugins'
import { defaultBatchClientServerOptions, defaultBatchGroup } from './client-server'

export const createHonoFetchBatchClientServerTest: CreateBatchClientServerTest = (
  router,
  {
    context = defaultBatchClientServerOptions.context,
    mode = defaultBatchClientServerOptions.mode,
    serializer = defaultBatchClientServerOptions.serializer,
  } = {},
) => {
  const handler = new RPCHandler(router, {
    serializer,
    plugins: [new BatchHandlerPlugin()],
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
  const fetchSpy = vi.fn((url: string, init: RequestInit) => fetch(url, { ...init, duplex: 'half' } as RequestInit))

  const link = new RPCLink({
    url: '/rpc',
    origin: `http://localhost:${addressInfo.port}`,
    serializer,
    fetch: fetchSpy,
    plugins: [new BatchLinkPlugin({ groups: [defaultBatchGroup], mode })],
  })

  return {
    client: createORPCClient(link),
    fetchSpy,
  }
}
