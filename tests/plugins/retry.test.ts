import type { ClientLink } from '@orpc/client'
import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { openapi } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { ORPCError, os, type } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'

/**
 * A call that sends a read-once body must not be retried, wherever the codec takes that body
 * from: a ReadableStream or AsyncIteratorObject is consumed by the first attempt, so a retry
 * would send it empty and the server would run the procedure without the data.
 */

function createRouter() {
  let calls = 0

  const collect = async (body: AsyncIterable<unknown>) => {
    if (calls++ === 0) {
      throw new ORPCError('INTERNAL_SERVER_ERROR')
    }

    const values: unknown[] = []
    for await (const value of body) {
      values.push(value)
    }

    return values
  }

  const router = {
    rpc: os
      .input(type<AsyncIterable<number>>())
      .handler(({ input }) => collect(input)),
    detailed: os
      .meta(openapi({ method: 'POST', path: '/detailed', inputStructure: 'detailed', requestBodyHint: 'event-stream' }))
      .input(type<{ body: AsyncIterable<number> }>())
      .handler(({ input }) => collect(input.body)),
  }

  return { router, getCalls: () => calls }
}

type TestRouter = ReturnType<typeof createRouter>['router']

const plugins = () => [new RetryLinkPlugin<RetryLinkPluginContext>({ default: { retry: 1, retryDelay: 0 } })]

async function* values() {
  yield 1
  yield 2
}

describe('retryLinkPlugin with a read-once request body', () => {
  it('does not retry an RPCLink call with an AsyncIteratorObject input', async () => {
    const { router, getCalls } = createRouter()
    const handler = new RPCHandler(router)

    const link: ClientLink<RetryLinkPluginContext> = new RPCLink({
      url: '/rpc',
      origin: 'http://localhost',
      plugins: plugins(),
      fetch: async (url, init) => (await handler.handle(new Request(url, init), { prefix: '/rpc', context: {} })).response!,
    })

    const client = createORPCClient<RouterClient<TestRouter, RetryLinkPluginContext>>(link)

    await expect(client.rpc(values())).rejects.toThrow('Internal Server Error')
    expect(getCalls()).toBe(1)
  })

  it('does not retry an OpenAPILink call with an AsyncIteratorObject in a detailed body', async () => {
    const { router, getCalls } = createRouter()
    const handler = new OpenAPIHandler(router)

    const link: ClientLink<RetryLinkPluginContext> = new OpenAPILink(router, {
      url: '/api',
      origin: 'http://localhost',
      plugins: plugins(),
      fetch: async (url, init) => (await handler.handle(new Request(url, init), { prefix: '/api', context: {} })).response!,
    })

    const client = createORPCClient<RouterClient<TestRouter, RetryLinkPluginContext>>(link)

    await expect(client.detailed({ body: values() })).rejects.toThrow('Internal Server Error')
    expect(getCalls()).toBe(1)
  })
})
