import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { sleep } from '@standardserver/shared'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openapi abort signal: %s', async (_name, createClientServer) => {
  const handler = vi.fn()
  const router = {
    ping: os
      .input(z.any())
      .meta(openapi({
        method: 'POST',
        path: '/ping',
      }))
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
