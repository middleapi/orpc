import type { RouterClient } from '@orpc/server'
import { createORPCClient, RPCSerializer } from '@orpc/client'
import { RPCLinkCodec, StandardLink } from '@orpc/client/standard'
import { ORPCError, os, type } from '@orpc/server'
import { RPCHandlerCodec, StandardHandler } from '@orpc/server/standard'
import { bench } from 'vitest'
import { asReadableStream, asSyncIteratorObject, BYTES_10KB, drainBody, EVENTS_10KB, handlers, PAYLOAD_10KB } from './__shared__/payloads'

const serializer = new RPCSerializer({ handlers })

const log = os.middleware(async ({ next }) => next())
const auth = os.middleware(async ({ next }) => next({ context: { userId: 'user-1' } }))

const router = {
  ping: os
    .input(type<any>())
    .output(type<any>())
    .handler(({ input }) => input),
  plain: os.handler(({ input }) => input),
  middlewares: os
    .use(log)
    .use(auth)
    .use(log)
    .handler(({ input }) => input),
  fail: os.handler(() => {
    throw new ORPCError('NOT_FOUND')
  }),
}

const handler = new StandardHandler(new RPCHandlerCodec(router, { serializer }), {})

const link = new StandardLink(new RPCLinkCodec({ serializer }), {
  async send(request, path, options) {
    const { matched, response } = await handler.handle(
      { ...request, resolveBody: () => Promise.resolve(request.body) },
      options,
    )

    if (matched) {
      return { ...response, resolveBody: () => Promise.resolve(response.body) }
    }

    return { status: 404, headers: {}, resolveBody: () => Promise.resolve('Not Found') }
  },
})

const client: RouterClient<typeof router> = createORPCClient(link)

describe('rpc link + handler', () => {
  bench('buffered', async () => {
    await client.ping(PAYLOAD_10KB)
  })

  bench('event stream', async () => {
    await drainBody(
      await client.ping(asSyncIteratorObject(EVENTS_10KB)),
    )
  })

  bench('octet stream', async () => {
    await drainBody(
      await client.ping(asReadableStream(BYTES_10KB)),
    )
  })

  describe('fixed overhead (tiny payload)', () => {
    const input = { id: 1 }

    bench('plain (no schema, no middleware)', async () => {
      await client.plain(input as any)
    })

    bench('middlewares x3', async () => {
      await client.middlewares(input as any)
    })

    bench('error thrown', async () => {
      await client.fail(undefined as any).catch(() => {})
    })

    bench('not found (404)', async () => {
      await (client as any).missing(input).catch(() => {})
    })
  })
})
