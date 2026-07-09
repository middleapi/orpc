import type { AddressInfo } from 'node:net'
import type { CreateClientServerTest } from './client-server'
import * as http from 'node:http'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RequestCompressionLinkPlugin } from '@orpc/client/plugins'
import { RPCHandler } from '@orpc/server/node'
import { RequestCompressionHandlerPlugin } from '@orpc/server/plugins'
import { defaultSerializer } from './client-server'

export const createCompressionNodeHttpClientServerTest: CreateClientServerTest = (
  router,
  { context = {}, serializer = defaultSerializer } = {},
) => {
  const handler = new RPCHandler(router, {
    serializer,
    plugins: [
      new RequestCompressionHandlerPlugin(),
    ],
  })

  const server = http.createServer(async (req, res) => {
    await handler.handle(req, res, {
      context,
      prefix: '/rpc',
    })
  })

  server.listen(0)

  afterAll(() => {
    server.close()
  })

  const addressInfo = server.address() as AddressInfo

  const link = new RPCLink({
    url: '/rpc',
    method: 'GET', // node-http use GET while hono-fetch use POST for better coverage
    origin: `http://localhost:${addressInfo.port}`,
    serializer,
    fetch(url, init) {
      return fetch(url, init)
    },
    plugins: [
      new RequestCompressionLinkPlugin({
        // for testing purpose, we set threshold to 0 to ensure compression is always applied
        threshold: 0,
      }),
    ],
  })

  return createORPCClient(link)
}
