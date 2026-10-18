import type { RouterClient } from '@orpc/server'
import type { AddressInfo } from 'node:net'
import { createORPCClient } from '@orpc/client'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { RPCLink } from '@orpc/client/websocket'
import { os, withEventMeta } from '@orpc/server'
import { RPCHandler } from '@orpc/server/websocket'
import { sleep } from '@standard-server/shared'
import WebSocket, { WebSocketServer } from 'ws'

describe('websocket keep-alive', () => {
  const router = {
    counter: os.handler(async function* ({ lastEventId }) {
      let id = Number(lastEventId ?? 0)

      while (true) {
        id++
        yield withEventMeta({ id }, { id: String(id) })
        await sleep(10)
      }
    }),
  }

  it('resumes an event iterator from lastEventId after the connection goes silent', async () => {
    const handler = new RPCHandler(router)
    const wss = new WebSocketServer({ port: 0 })
    onTestFinished(() => {
      wss.clients.forEach(ws => ws.terminate())
      wss.close()
    })

    let connections = 0
    wss.on('connection', (ws) => {
      const connection = ++connections
      let sent = 0

      handler.upgrade({
        addEventListener: ws.addEventListener.bind(ws),
        removeEventListener: ws.removeEventListener.bind(ws),
        close: ws.close.bind(ws),
        send: (data) => {
          // like a half-open connection, the first one stops delivering (pongs included)
          // after the response and two events, while the socket stays open
          if (connection === 1 && ++sent > 3) {
            return
          }

          ws.send(data)
        },
      } as Parameters<typeof handler.upgrade>[0])
    })

    const link = new RPCLink({
      connect: () => new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`),
      reconnect: { enabled: true },
      keepAlive: { enabled: true, interval: 20, timeout: 50 },
      plugins: [new RetryLinkPlugin({ default: { retry: 3, retryDelay: 0 } })],
    })

    const client: RouterClient<typeof router> = createORPCClient(link)

    const ids: number[] = []
    for await (const event of await client.counter()) {
      ids.push(event.id)

      if (ids.length === 5) {
        break
      }
    }

    expect(ids).toEqual([1, 2, 3, 4, 5])
    expect(connections).toBe(2)
  })
})
