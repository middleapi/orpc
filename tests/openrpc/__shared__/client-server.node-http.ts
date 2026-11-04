import type { AddressInfo } from 'node:net'
import type { CreateOpenRPCClientServerTest } from './client-server'
import * as http from 'node:http'
import { createORPCClient } from '@orpc/client'
import { OpenRPCLink } from '@orpc/openrpc/fetch'
import { OpenRPCHandler } from '@orpc/openrpc/node'

export const createNodeHttpClientServerTest: CreateOpenRPCClientServerTest = (
  router,
  { context = {}, serializer, handlerPlugins, linkPlugins } = {},
) => {
  const handler = new OpenRPCHandler(router, {
    serializer,
    plugins: handlerPlugins,
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
