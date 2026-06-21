import type { FetchHandlerFetchInterceptor } from './handler'
import { BodyCompressionHandlerPlugin } from './body-compression-plugin'
import { RPCHandler } from './rpc-handler'

describe('bodyCompressionHandlerPlugin', () => {
  const largeText = 'x'.repeat(2000)
  const smallText = 'small response'

  function createHandler(
    response: Response,
    options: ConstructorParameters<typeof BodyCompressionHandlerPlugin>[0] = {},
  ): RPCHandler<any> {
    const fetchInterceptor: FetchHandlerFetchInterceptor<any> = async () => ({
      matched: true,
      response,
    })

    return new RPCHandler({}, {
      plugins: [new BodyCompressionHandlerPlugin(options)],
      fetchInterceptors: [fetchInterceptor],
    })
  }

  it('does not compress responses when the client does not accept compression', async () => {
    const handler = createHandler(new Response(largeText, {
      headers: {
        'content-length': largeText.length.toString(),
        'content-type': 'text/plain',
      },
    }))

    const { matched, response } = await handler.handle(new Request('https://example.com/ping'))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toBe(largeText)
    expect(response!.headers.has('content-encoding')).toBe(false)
  })

  it('returns unmatched results without modifying them', async () => {
    const handler = new RPCHandler({}, {
      plugins: [new BodyCompressionHandlerPlugin()],
      fetchInterceptors: [async () => ({ matched: false })],
    })

    const result = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip',
      },
    }))

    expect(result).toEqual({ matched: false })
  })

  it('compresses responses with gzip when the client accepts it', async () => {
    const handler = createHandler(new Response(largeText, {
      headers: {
        'content-length': largeText.length.toString(),
        'content-type': 'text/plain',
      },
    }))

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip, deflate',
      },
    }))

    expect(matched).toBe(true)
    expect(response!.headers.get('content-encoding')).toBe('gzip')

    const decompressed = response!.body!.pipeThrough(new DecompressionStream('gzip'))
    await expect(new Response(decompressed).text()).resolves.toBe(largeText)
  })

  it('respects a custom filter override', async () => {
    const filter = vi.fn(() => true)

    const handler = createHandler(new Response(largeText, {
      headers: {
        'content-length': largeText.length.toString(),
        'content-type': 'application/octet-stream',
      },
    }), {
      filter,
    })

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip',
      },
    }))

    expect(matched).toBe(true)
    expect(filter).toHaveBeenCalledOnce()
    expect(response!.headers.get('content-encoding')).toBe('gzip')

    const decompressed = response!.body!.pipeThrough(new DecompressionStream('gzip'))
    await expect(new Response(decompressed).text()).resolves.toBe(largeText)
  })

  it('does not compress responses below the configured threshold', async () => {
    const handler = createHandler(new Response(smallText, {
      headers: {
        'content-length': smallText.length.toString(),
        'content-type': 'text/plain',
      },
    }), {
      threshold: 1024,
    })

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip',
      },
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toBe(smallText)
    expect(response!.headers.has('content-encoding')).toBe(false)
  })

  it('does not compress event stream responses', async () => {
    const handler = createHandler(new Response('data: ping\n\n', {
      headers: {
        'content-type': 'text/event-stream',
      },
    }))

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip',
      },
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toBe('data: ping\n\n')
    expect(response!.headers.has('content-encoding')).toBe(false)
  })

  it('does not compress responses without a content-type by default', async () => {
    const body = new TextEncoder().encode(largeText)

    const handler = createHandler(new Response(body, {
      headers: {
        'content-length': body.byteLength.toString(),
      },
    }))

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip',
      },
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toBe(largeText)
    expect(response!.headers.has('content-encoding')).toBe(false)
  })

  it('does not compress responses that already disallow transformation', async () => {
    const handler = createHandler(new Response(largeText, {
      headers: {
        'cache-control': 'public, no-transform',
        'content-length': largeText.length.toString(),
        'content-type': 'text/plain',
      },
    }))

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        'accept-encoding': 'gzip',
      },
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toBe(largeText)
    expect(response!.headers.has('content-encoding')).toBe(false)
  })
})
