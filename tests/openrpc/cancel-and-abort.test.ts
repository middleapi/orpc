import { os } from '@orpc/server'
import { sleep } from '@standard-server/shared'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openrpc cancel and abort: %s', (_name, createClientServer) => {
  const handler = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
    await sleep(200)
    return signal?.aborted
  })

  const router = {
    ping: os.input(z.any()).handler(handler),
  }

  const { client, url } = createClientServer(router)

  beforeEach(() => {
    handler.mockClear()
  })

  it('server signal should abort when client signal is aborted', async () => {
    const controller = new AbortController()

    const promise = expect(client.ping(null, { signal: controller.signal })).rejects.toThrowError('abort')

    await sleep(100)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0].signal!.aborted).toBe(false)

    controller.abort()
    await promise
    await sleep(100)
    expect(handler.mock.calls[0]![0].signal!.aborted).toBe(true)
  })

  it('server signals of every call in a batch should abort when the client aborts', async () => {
    const controller = new AbortController()

    const promise = expect(fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', method: 'ping', params: [1], id: 1 },
        { jsonrpc: '2.0', method: 'ping', params: [2], id: 2 },
        { jsonrpc: '2.0', method: 'ping', params: [3] },
      ]),
      signal: controller.signal,
    })).rejects.toThrowError('abort')

    await sleep(100)
    expect(handler).toHaveBeenCalledTimes(3)
    expect(handler.mock.calls.map(([{ signal }]) => signal!.aborted)).toEqual([false, false, false])

    controller.abort()
    await promise
    await sleep(100)
    expect(handler.mock.calls.map(([{ signal }]) => signal!.aborted)).toEqual([true, true, true])
  })

  it('server signal of a notification should abort when the client aborts', async () => {
    const controller = new AbortController()

    const promise = expect(fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', params: [1] }),
      signal: controller.signal,
    })).rejects.toThrowError('abort')

    await sleep(100)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0].signal!.aborted).toBe(false)

    controller.abort()
    await promise
    await sleep(100)
    expect(handler.mock.calls[0]![0].signal!.aborted).toBe(true)
  })
})
