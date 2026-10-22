import type { ClientContext } from '@orpc/client'
import type { AnyRouter } from '@orpc/server'
import type { AddressInfo } from 'node:net'
import type { CreateOpenRPCClientServerTest, OpenRPCClientServerTest, OpenRPCClientServerTestOptions } from './client-server'
import { serve } from '@hono/node-server'
import { createORPCClient } from '@orpc/client'
import { OpenRPCHandler, OpenRPCLink } from '@orpc/openrpc/fetch'
import { OPENRPC_PREFIX } from './client-server'

export const createHonoFetchClientServerTest: CreateOpenRPCClientServerTest = <T extends AnyRouter, TClientContext extends ClientContext = Record<never, never>>(
  router: T,
  { context = {}, handler: handlerOptions, link: linkOptions }: OpenRPCClientServerTestOptions<TClientContext> = {},
): OpenRPCClientServerTest<T, TClientContext> => {
  const handler = new OpenRPCHandler(router, handlerOptions)

  const server = serve({
    fetch: async (request: Request) => {
      const { response } = await handler.handle(request, {
        context,
        prefix: OPENRPC_PREFIX,
      })

      return response ?? new Response('Not Found', { status: 404 })
    },
    port: 0,
  })

  afterAll(() => {
    server.close()
  })

  const origin = `http://localhost:${(server.address() as AddressInfo).port}`
  const fetchSpy = vi.fn((url: string, init: RequestInit) => fetch(url, init))

  const link = new OpenRPCLink<TClientContext>({
    ...linkOptions,
    url: OPENRPC_PREFIX,
    origin,
    fetch: fetchSpy,
  })

  return {
    client: createORPCClient(link),
    link,
    origin,
    url: `${origin}${OPENRPC_PREFIX}`,
    fetchSpy,
  }
}
