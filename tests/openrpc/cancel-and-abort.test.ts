import { os } from '@orpc/server'
import { sleep } from '@standard-server/shared'
import WebSocket from 'ws'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'
import { createNodeWsClientServerTest } from './__shared__/client-server.node-ws'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('cancel and abort: %s', async (_name, createClientServer) => {
  const handler = vi.fn()
  const router = {
    ping: os
      .input(z.any())
      .handler(handler),
  }
  const client = createClientServer(router)

  it('server signal should abort when client signal is aborted', async () => {
    handler.mockImplementationOnce(async ({ signal }) => {
      await sleep(200)

      return signal.aborted
    })

    const controller = new AbortController()

    const promise = expect(client.ping(null, { signal: controller.signal })).rejects.toThrowError('abort')

    await sleep(100)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0].signal.aborted).toBe(false)

    controller.abort()
    await promise
    await sleep(100)
    expect(handler.mock.calls[0]![0].signal.aborted).toBe(true)
  })
})

// JSON-RPC has no cancel message, so over WebSocket a call is only aborted on the server when its socket closes
describe('cancel and abort: node-ws', () => {
  const handler = vi.fn()
  const router = {
    ping: os
      .input(z.any())
      .handler(handler),
  }
  const client = createNodeWsClientServerTest(router)

  it('server signal should abort when the socket closes, not when client signal is aborted', async () => {
    handler.mockImplementationOnce(async () => {
      await sleep(300)
    })

    const send = vi.spyOn(WebSocket.prototype, 'send')
    const controller = new AbortController()

    const promise = expect(client.ping(null, { signal: controller.signal })).rejects.toThrowError('abort')

    await sleep(100)
    const socket = send.mock.contexts[0] as WebSocket // the client socket, which sent the request
    send.mockRestore()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0].signal.aborted).toBe(false)

    controller.abort()
    await promise
    await sleep(100)
    expect(handler.mock.calls[0]![0].signal.aborted).toBe(false)

    socket.close()
    await sleep(100)
    expect(handler.mock.calls[0]![0].signal.aborted).toBe(true)
  })
})
