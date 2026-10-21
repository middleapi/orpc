import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import type { RouterClient } from '@orpc/server'
import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { z } from 'zod'

describe('retry plugin', () => {
  let attempts = 0

  const router = {
    validate: os
      .input(z.object({ id: z.number() }))
      .handler(() => 'OK'),
    conflict: os
      .errors({ CONFLICT: {} })
      .handler(({ errors }) => {
        throw errors.CONFLICT()
      }),
    unavailable: os.handler(() => {
      if (++attempts < 2) {
        throw new ORPCError('SERVICE_UNAVAILABLE')
      }

      return 'OK'
    }),
    outOfStock: os
      .errors({ OUT_OF_STOCK: {} })
      .handler(({ errors }) => {
        throw errors.OUT_OF_STOCK()
      }),
    badGateway: os
      .errors({ BAD_GATEWAY: {} })
      .handler(({ errors }) => {
        if (++attempts < 2) {
          throw errors.BAD_GATEWAY()
        }

        return 'OK'
      }),
    stream: os
      .errors({ UNAUTHORIZED: {} })
      .handler(async function* ({ errors }) {
        yield 'first'

        if (++attempts < 2) {
          throw errors.UNAUTHORIZED()
        }
      }),
  }

  const handler = new RPCHandler(router)

  const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
    const { response } = await handler.handle(new Request(url, init))

    return response ?? new Response(null, { status: 404 })
  })

  const client: RouterClient<typeof router, RetryLinkPluginContext> = createORPCClient(new RPCLink({
    origin: 'http://localhost',
    fetch: fetchSpy,
    plugins: [new RetryLinkPlugin({ default: { retry: 3, retryDelay: 0 } })],
  }))

  beforeEach(() => {
    attempts = 0
    fetchSpy.mockClear()
  })

  it('does not retry client error responses', async () => {
    await expect(client.validate({ id: 'invalid' as any })).rejects.toMatchObject({ defined: false, code: 'BAD_REQUEST' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not retry defined errors sent with a client error status', async () => {
    await expect(client.conflict()).rejects.toMatchObject({ defined: true, code: 'CONFLICT' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries server error responses', async () => {
    await expect(client.unavailable()).resolves.toBe('OK')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries defined errors sent with a server error status', async () => {
    await expect(client.badGateway()).resolves.toBe('OK')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry errors with codes missing from the errorStatusMap', async () => {
    // OUT_OF_STOCK is missing from the handler's errorStatusMap, so it is sent with the fallback 400 status
    await expect(client.outOfStock()).rejects.toMatchObject({ defined: true, code: 'OUT_OF_STOCK' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reconnects an AsyncIteratorObject on errors thrown mid-stream', async () => {
    const iterator = await client.stream()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'first' })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'first' })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
