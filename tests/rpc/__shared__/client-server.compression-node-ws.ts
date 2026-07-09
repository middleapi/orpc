import type { AddressInfo } from 'node:net'
import type { CreateClientServerTest } from './client-server'
import { createORPCClient } from '@orpc/client'
import { RequestCompressionLinkPlugin } from '@orpc/client/plugins'
import { RPCLink } from '@orpc/client/websocket'
import { RequestCompressionHandlerPlugin } from '@orpc/server/plugins'
import { RPCHandler } from '@orpc/server/websocket'
import WebSocket, { WebSocketServer } from 'ws'
import { defaultSerializer } from './client-server'

export const createCompressionNodeWsClientServerTest: CreateClientServerTest = (
  router,
  { context = {}, serializer = defaultSerializer } = {},
) => {
  const handler = new RPCHandler(router, {
    serializer,
    encodePeerMessage: { prefix: '__PREFIX__' },
    decodePeerMessage: { prefix: '__PREFIX__' },
    plugins: [
      new RequestCompressionHandlerPlugin(),
    ],
  })

  const wss = new WebSocketServer({ port: 0 })

  wss.on('connection', (ws) => {
    handler.upgrade(ws, {
      context,
      prefix: '/rpc',
    })
  })

  afterAll(() => {
    wss.close()
  })

  const addressInfo = wss.address() as AddressInfo

  const link = new RPCLink({
    url: '/rpc',
    connect: () => new WebSocket(`ws://localhost:${addressInfo.port}`),
    serializer,
    encodePeerMessage: { prefix: '__PREFIX__' },
    decodePeerMessage: { prefix: '__PREFIX__' },
    plugins: [
      new RequestCompressionLinkPlugin({
        // for testing purpose, we set threshold to 0 to ensure compression is always applied
        threshold: 0,
      }),
    ],
  })

  return createORPCClient(link)
}
