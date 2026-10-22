import type { ClientContext } from '@orpc/client'
import type { AnyRouter } from '@orpc/server'
import type { AddressInfo } from 'node:net'
import type { CreateOpenRPCClientServerTest, OpenRPCClientServerTest, OpenRPCClientServerTestOptions } from './client-server'
import * as http from 'node:http'
import { createORPCClient } from '@orpc/client'
import { OpenRPCLink } from '@orpc/openrpc/fetch'
import { OpenRPCHandler } from '@orpc/openrpc/node'
import { OPENRPC_PREFIX } from './client-server'

export const createNodeHttpClientServerTest: CreateOpenRPCClientServerTest = <T extends AnyRouter, TClientContext extends ClientContext = Record<never, never>>(
  router: T,
  { context = {}, handler: handlerOptions, link: linkOptions }: OpenRPCClientServerTestOptions<TClientContext> = {},
): OpenRPCClientServerTest<T, TClientContext> => {
  const handler = new OpenRPCHandler(router, handlerOptions)

  const server = http.createServer(async (req, res) => {
    const { matched } = await handler.handle(req, res, {
      context,
      prefix: OPENRPC_PREFIX,
    })

    if (!matched) {
      res.statusCode = 404
      res.end('Not Found')
    }
  })

  server.listen(0)

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
