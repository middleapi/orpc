import type { AddressInfo } from 'node:net'
import type { CreateOpenRPCClientServerTest } from './client-server'
import { createORPCClient } from '@orpc/client'
import { OpenRPCHandler, OpenRPCLink } from '@orpc/openrpc/websocket'
import WebSocket, { WebSocketServer } from 'ws'

export const createNodeWsClientServerTest: CreateOpenRPCClientServerTest = (
  router,
  { context = {}, serializer, handlerPlugins, linkPlugins } = {},
) => {
  const handler = new OpenRPCHandler(router, {
    serializer,
    plugins: handlerPlugins,
  })

  const wss = new WebSocketServer({ port: 0 })

  wss.on('connection', (ws) => {
    handler.upgrade(ws, {
      context,
      prefix: '/rpc',
    })
  })

  afterAll(() => {
    wss.clients.forEach(ws => ws.close())
    wss.close()
  })

  const addressInfo = wss.address() as AddressInfo

  const link = new OpenRPCLink({
    connect: () => new WebSocket(`ws://localhost:${addressInfo.port}`),
    serializer,
    plugins: linkPlugins,
  })

  return createORPCClient(link)
}
