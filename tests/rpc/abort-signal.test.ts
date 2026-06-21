import { os } from '@orpc/server'
import { sleep } from '@standardserver/shared'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createMessagePortClientServerTest } from './__shared__/client-server.message-port'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'
import { createNodeWsClientServerTest } from './__shared__/client-server.node-ws'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
  ['message-port', createMessagePortClientServerTest],
  ['node-ws', createNodeWsClientServerTest],
])('abort signal: %s', async (_name, createClientServer) => {
  const handler = vi.fn()
  const router = {
    ping: os.input(z.any()).handler(handler),
  }
  const client = createClientServer(router)

  it('server signal should abort when client signal is aborted', async () => {
    handler.mockImplementationOnce(async ({ signal }) => {
      await sleep(200)
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
