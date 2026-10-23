import type { JsonifiedClient } from '@orpc/openapi'
import type { RouterClient } from '@orpc/server'
import { createORPCClient, isDefinedError, ORPCError, safe } from '@orpc/client'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { os } from '@orpc/server'
import { z } from 'zod'
import { OpenRPCHandler } from './openrpc-handler'
import { OpenRPCLink } from './openrpc-link'

const flaky = vi.fn()

const router = {
  planet: {
    find: os
      .errors({ NOT_FOUND: { data: z.object({ id: z.number() }) } })
      .input(z.object({ id: z.number() }))
      .handler(({ input, errors }) => {
        if (input.id !== 1) {
          throw errors.NOT_FOUND({ data: { id: input.id } })
        }

        return { id: 1, discoveredAt: new Date(0) }
      }),
    echo: os.input(z.any()).handler(({ input }) => input),
    flaky: os.handler(flaky),
  },
}

const handler = new OpenRPCHandler(router)

function createClient(fetch: (request: Request) => Promise<Response>, options: ConstructorParameters<typeof OpenRPCLink>[0] = {}) {
  return createORPCClient<JsonifiedClient<RouterClient<typeof router>>>(new OpenRPCLink({
    url: '/rpc',
    origin: 'http://localhost',
    fetch: (url, init) => fetch(new Request(url, init)),
    ...options,
  }))
}

function respond(body: unknown, status = 200) {
  return createClient(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

describe('openRPCLink', () => {
  const bodies: unknown[] = []
  const fetch = vi.fn(async (request: Request) => {
    bodies.push(await request.clone().json())
    return (await handler.handle(request, { prefix: '/rpc' })).response!
  })
  const client = createClient(fetch)

  beforeEach(() => {
    fetch.mockClear()
    bodies.length = 0
  })

  it('sends JSON-RPC requests and decodes results', async () => {
    await expect(client.planet.find({ id: 1 })).resolves.toEqual({ id: 1, discoveredAt: '1970-01-01T00:00:00.000Z' })
    await expect(client.planet.echo('text')).resolves.toBe('text')
    await expect(client.planet.echo([1, 2])).resolves.toEqual([1, 2])
    await expect(client.planet.echo(undefined)).resolves.toBe(null)

    expect(bodies).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'planet.find', params: { id: 1 } },
      { jsonrpc: '2.0', id: 2, method: 'planet.echo', params: ['text'] },
      { jsonrpc: '2.0', id: 3, method: 'planet.echo', params: [[1, 2]] },
      { jsonrpc: '2.0', id: 4, method: 'planet.echo' },
    ])
  })

  it('restores ORPCErrors of oRPC servers', async () => {
    const [error] = await safe(client.planet.find({ id: 2 }))

    expect(isDefinedError(error)).toBe(true)
    expect(error).toMatchObject({ code: 'NOT_FOUND', data: { id: 2 }, cause: { response: { status: 404 } } })
  })

  it('decodes errors of other servers by their code', async () => {
    await expect(respond({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }).planet.echo(1))
      .rejects
      .toMatchObject({ code: 'NOT_FOUND', defined: false, message: 'Method not found' })
    await expect(respond({ jsonrpc: '2.0', id: null, error: { code: 3, message: 'execution reverted', data: '0x' } }).planet.echo(1))
      .rejects
      .toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'execution reverted', data: '0x' })
  })

  it.each([
    [{ jsonrpc: '2.0', id: 2, result: 1 }],
    [{ jsonrpc: '2.0', id: null, result: 1 }],
    [{ jsonrpc: '2.0', id: 1, result: 1, error: { code: 1, message: 'x' } }],
    [[{ jsonrpc: '2.0', id: 1, result: 1 }]],
    ['<html></html>'],
  ])('rejects malformed response %j', async (body) => {
    await expect(respond(body).planet.echo(1)).rejects.toThrow('Invalid JSON-RPC response.')
  })

  it('retries errors with a server status, but not client errors', async () => {
    const retry = createClient(fetch, { plugins: [new RetryLinkPlugin({ default: { retry: 1 } })] })

    flaky.mockImplementationOnce(() => {
      throw new ORPCError('SERVICE_UNAVAILABLE')
    }).mockReturnValueOnce('ok')
    await expect(retry.planet.flaky()).resolves.toBe('ok')

    await expect(retry.planet.find({ id: 2 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('throws for inputs JSON-RPC cannot send', async () => {
    await expect(client.planet.echo(new Blob(['x']))).rejects.toThrow('JSON-RPC cannot send streams or binary data')
    expect(fetch).not.toHaveBeenCalled()
  })
})
