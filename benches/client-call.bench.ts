import type { ClientLink } from '@orpc/client'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RPCLinkCodec, StandardLink } from '@orpc/client/standard'
import { stringifyJSON } from '@orpc/shared'
import { bench } from 'vitest'

const INPUT = { id: 1, name: 'oRPC' }

const noopInterceptor = ({ next }: { next: () => Promise<unknown> }) => next()

const memoryTransport = {
  send: async () => ({
    status: 200,
    headers: {},
    resolveBody: () => Promise.resolve({ json: INPUT }),
  }),
}

const memoryLink = new StandardLink(new RPCLinkCodec({ url: '/rpc' }), memoryTransport)
const memoryGetLink = new StandardLink(
  new RPCLinkCodec({ url: '/rpc', method: 'GET' }),
  memoryTransport,
)

const fetchLink = new RPCLink({
  origin: 'http://localhost',
  url: '/rpc',
  fetch: async () =>
    new Response(stringifyJSON({ json: INPUT }), {
      headers: { 'content-type': 'application/json' },
    }),
})

const noopLink: ClientLink<object> = { call: async (_path, input) => input }

const noopClient = createORPCClient<any>(noopLink)
const noopInterceptedClient = createORPCClient<any>(noopLink, {
  interceptors: [noopInterceptor],
  scoped: { nested: { ping: { interceptors: [noopInterceptor] } } },
})
const memoryClient = createORPCClient<any>(memoryLink)
const memoryGetClient = createORPCClient<any>(memoryGetLink)
const fetchClient = createORPCClient<any>(fetchLink)

describe('client call', () => {
  bench('createORPCClient + noop link', async () => {
    await noopClient.nested.ping(INPUT)
  })

  bench('createORPCClient + noop link + interceptors', async () => {
    await noopInterceptedClient.nested.ping(INPUT)
  })

  bench('StandardLink + RPCLinkCodec (POST)', async () => {
    await memoryClient.nested.ping(INPUT)
  })

  bench('StandardLink + RPCLinkCodec (GET)', async () => {
    await memoryGetClient.nested.ping(INPUT)
  })

  bench('RPCLink + fetch', async () => {
    await fetchClient.nested.ping(INPUT)
  })
})
