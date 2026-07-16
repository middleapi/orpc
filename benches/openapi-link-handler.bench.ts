import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { OpenAPISerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { os, type } from '@orpc/server'
import { bench } from 'vitest'
import { asEventStream, asOctetStream, cases, drainBody, eventCases, handlers, octetCases } from './__shared__/payloads'

/**
 * End-to-end RPC path with inline fetch (no network / HTTP server):
 * createORPCClient → RPCLink → RPCHandler → response
 *
 * Exercises encode, fetch transport, decode, procedure dispatch, and
 * the reverse response path for JSON-like payloads, event streams (SSE),
 * and octet streams.
 */

const serializer = new OpenAPISerializer({ handlers })

const router = {
  ping: os
    .input(type<any>())
    .output(type<any>())
    .handler(({ input }) => input),
}

const handler = new OpenAPIHandler(router, { serializer })

const link = new OpenAPILink(router, {
  origin: 'http://localhost',
  url: '/rpc',
  serializer,
  fetch: async (url, init) => {
    const request = new Request(url, init)
    const { response } = await handler.handle(request, {
      prefix: '/rpc',
    })

    return response ?? new Response('Not Found', { status: 404 })
  },
})

const client: RouterClient<typeof router> = createORPCClient(link)

describe('openapi link + handler e2e (inline fetch)', () => {
  for (const [label, payload] of cases) {
    bench(`${label} buffered`, async () => {
      await client.ping(payload)
    })
  }

  for (const [label, parts] of eventCases) {
    bench(`${label} event stream`, async () => {
      const output = await client.ping(asEventStream(parts))
      await drainBody(output)
    })
  }

  for (const [label, parts] of octetCases) {
    bench(`${label} octet stream`, async () => {
      const output = await client.ping(asOctetStream(parts))
      await drainBody(output)
    })
  }
})
