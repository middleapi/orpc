import type { StandardLinkPlugin } from '@orpc/client/standard'
import type { JsonifiedClient } from '@orpc/openapi'
import type { RouterClient } from '@orpc/server'
import type { OpenRPCLinkOptions } from './openrpc-link'
import { createORPCClient, isDefinedError, MalformedResponseError, ORPCError, safe } from '@orpc/client'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { os } from '@orpc/server'
import { z } from 'zod'
import { OpenRPCHandler } from './openrpc-handler'
import { OpenRPCLink } from './openrpc-link'

describe('openRPCLink', () => {
  const date = new Date('2024-01-02T03:04:05.000Z')
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

          return { id: 1, discoveredAt: date }
        }),
      echo: os.input(z.any()).handler(({ input }) => input),
      buy: os.handler(() => {
        throw new ORPCError('OUT_OF_STOCK', { message: 'Sold out', data: { left: 0 } })
      }),
      flaky: os.handler(flaky),
    },
  }

  const handler = new OpenRPCHandler(router)

  const bodies: unknown[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const request = new Request(url, init)
    bodies.push(await request.clone().json())

    const { matched, response } = await handler.handle(request, { prefix: '/rpc' })

    if (!matched || !response) {
      throw new Error('No procedure match')
    }

    return response
  })

  function createClient(options: OpenRPCLinkOptions<any> = {}) {
    return createORPCClient<JsonifiedClient<RouterClient<typeof router>>>(new OpenRPCLink({
      fetch,
      origin: 'http://localhost:3000',
      url: '/rpc',
      ...options,
    }))
  }

  let client: ReturnType<typeof createClient>

  beforeEach(() => {
    vi.clearAllMocks()
    bodies.length = 0
    // request ids count per link, so each test starts at 1
    client = createClient()
  })

  it('calls a JSON-RPC endpoint through fetch transport', async () => {
    await expect(client.planet.find({ id: 1 })).resolves.toEqual({ id: 1, discoveredAt: date.toISOString() })

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/rpc',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({ context: {} }),
      ['planet', 'find'],
    )
    expect(bodies).toEqual([{ jsonrpc: '2.0', id: '1', method: 'planet.find', params: { id: 1 } }])
  })

  it('sends inputs by-name, by-position, or without params', async () => {
    await client.planet.echo({ nested: { date, arr: [3, date] }, big: 1n })
    await client.planet.echo('text')
    await client.planet.echo([1, 2])
    await client.planet.echo(undefined)

    expect(bodies).toEqual([
      { jsonrpc: '2.0', id: '1', method: 'planet.echo', params: { nested: { date: date.toISOString(), arr: [3, date.toISOString()] }, big: '1' } },
      { jsonrpc: '2.0', id: '2', method: 'planet.echo', params: ['text'] },
      { jsonrpc: '2.0', id: '3', method: 'planet.echo', params: [[1, 2]] },
      { jsonrpc: '2.0', id: '4', method: 'planet.echo' },
    ])
  })

  it('restores ORPCErrors of oRPC servers', async () => {
    const [error] = await safe(client.planet.find({ id: 2 }))

    expect(isDefinedError(error)).toBe(true)
    expect(error).toMatchObject({ code: 'NOT_FOUND', data: { id: 2 }, cause: { response: { status: 404 } } })

    await expect(client.planet.buy()).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      defined: false,
      message: 'Sold out',
      data: { left: 0 },
      cause: { response: { status: 400 } },
    })
  })

  it('decodes protocol errors of the handler', async () => {
    await expect((client as any).planet.missing()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      defined: false,
      message: 'Method not found',
      cause: { response: { status: 404 } },
    })

    // a proxy changing the content type: the whole request is rejected with a `null` id and its real status
    const textPlain = createClient({ fetch: (url, init) => fetch(url, { ...init, headers: { 'content-type': 'text/plain' } }) })

    await expect(textPlain.planet.echo(1)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      defined: false,
      cause: { response: { status: 415 } },
    })
  })

  it('throws MalformedResponseError on responses that are not JSON', async () => {
    const proxy = createClient({ fetch: async () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }) })
    const [error] = await safe(proxy.planet.echo(1))

    expect(error).toBeInstanceOf(MalformedResponseError)
    expect(error).toMatchObject({ message: 'Bad Gateway', response: { status: 502 }, cause: expect.any(SyntaxError) })
  })

  it('retries errors with a server status, but not client errors', async () => {
    const retry = createClient({ plugins: [new RetryLinkPlugin({ default: { retry: 1 } })] })

    flaky.mockImplementationOnce(() => {
      throw new ORPCError('SERVICE_UNAVAILABLE')
    }).mockReturnValueOnce('ok')
    await expect(retry.planet.flaky()).resolves.toBe('ok')

    await expect(retry.planet.find({ id: 2 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('supports standard link plugins', async () => {
    const plugin: StandardLinkPlugin<any> = {
      name: 'test',
      init() {
        return {
          transportInterceptors: [
            async ({ request }) => ({
              status: 200,
              headers: {},
              resolveBody: async () => ({ jsonrpc: '2.0', id: (request.body as { id: number }).id, result: 'intercepted' }),
            }),
          ],
        }
      },
    }

    await expect(createClient({ plugins: [plugin] }).planet.echo('ignored')).resolves.toBe('intercepted')
    expect(fetch).not.toHaveBeenCalled()
  })
})
