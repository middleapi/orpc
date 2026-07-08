import type { FetchHandlerFetchInterceptor } from './handler'
import { os } from '../../builder'
import { BatchHandlerPlugin } from '../../plugins/batch'
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

  it('does not compress octet-stream responses for non-batch requests', async () => {
    const body = new TextEncoder().encode(largeText)

    const handler = createHandler(new Response(body, {
      headers: {
        'content-length': body.byteLength.toString(),
        'content-type': 'application/octet-stream',
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

  describe('batch responses', () => {
    const largeValue = 'a'.repeat(500)

    function makePeerRequestMessage(id: number, url: string) {
      return {
        kind: 'request',
        id,
        json: { method: 'POST', url, headers: {}, body: undefined },
        binary: undefined,
      }
    }

    function createBatchRequest(mode: 'buffered' | 'streaming', messages: unknown) {
      return new Request('https://example.com/__batch__', {
        method: 'POST',
        headers: {
          'accept-encoding': 'gzip',
          'content-type': 'application/json',
          'orpc-batch': mode,
        },
        body: JSON.stringify(messages),
      })
    }

    function createBatchHandler(
      router: Parameters<typeof RPCHandler>[0],
      options: ConstructorParameters<typeof BodyCompressionHandlerPlugin>[0] = {},
    ): RPCHandler<any> {
      return new RPCHandler(router, {
        plugins: [new BatchHandlerPlugin(), new BodyCompressionHandlerPlugin(options)],
      })
    }

    it('compresses streaming batch responses', async () => {
      const handler = createBatchHandler({
        ping: os.handler(() => largeValue),
      })

      const { matched, response } = await handler.handle(createBatchRequest('streaming', [
        makePeerRequestMessage(0, '/ping'),
        makePeerRequestMessage(1, '/ping'),
      ]))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)
      expect(response!.headers.get('content-encoding')).toBe('gzip')

      const decompressed = response!.body!.pipeThrough(new DecompressionStream('gzip'))
      const text = await new Response(decompressed).text()
      expect(text).toContain(largeValue)
    })

    it('flushes each compressed batch message without waiting for the whole batch', async () => {
      let resolveSlow!: (value: string) => void
      const slow = new Promise<string>((resolve) => {
        resolveSlow = resolve
      })

      const handler = createBatchHandler({
        fast: os.handler(() => largeValue),
        slow: os.handler(() => slow),
      })

      const { response } = await handler.handle(createBatchRequest('streaming', [
        makePeerRequestMessage(0, '/fast'),
        makePeerRequestMessage(1, '/slow'),
      ]))

      expect(response!.headers.get('content-encoding')).toBe('gzip')

      const reader = response!.body!.pipeThrough(new DecompressionStream('gzip')).getReader()
      const decoder = new TextDecoder()

      /**
       * A flush-capable compressor delivers the fast message while the slow one
       * is still pending. A buffering compressor (e.g. `CompressionStream`)
       * would hold it back until the stream ends and these reads would never
       * resolve (test times out) because the slow handler is not resolved yet.
       */
      let received = ''
      while (!received.includes(largeValue)) {
        const { value } = await reader.read()
        received += decoder.decode(value, { stream: true })
      }

      resolveSlow('slow-result')

      while (!received.includes('slow-result')) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        received += decoder.decode(value, { stream: true })
      }

      expect(received).toContain('slow-result')
    })

    it('compresses streaming batch responses with deflate when preferred', async () => {
      const handler = createBatchHandler({
        ping: os.handler(() => largeValue),
      })

      const { response } = await handler.handle(new Request('https://example.com/__batch__', {
        method: 'POST',
        headers: {
          'accept-encoding': 'deflate',
          'content-type': 'application/json',
          'orpc-batch': 'streaming',
        },
        body: JSON.stringify([makePeerRequestMessage(0, '/ping')]),
      }))

      expect(response!.headers.get('content-encoding')).toBe('deflate')

      const decompressed = response!.body!.pipeThrough(new DecompressionStream('deflate'))
      const text = await new Response(decompressed).text()
      expect(text).toContain(largeValue)
    })

    it('compresses buffered batch responses as json (unchanged behavior)', async () => {
      const handler = createBatchHandler({
        ping: os.handler(() => largeValue),
      })

      const { response } = await handler.handle(createBatchRequest('buffered', [
        makePeerRequestMessage(0, '/ping'),
        makePeerRequestMessage(1, '/ping'),
      ]))

      expect(response!.status).toBe(207)
      expect(response!.headers.get('content-type')).toContain('application/json')
      expect(response!.headers.get('content-encoding')).toBe('gzip')

      const decompressed = response!.body!.pipeThrough(new DecompressionStream('gzip'))
      const text = await new Response(decompressed).text()
      expect(text).toContain(largeValue)
    })

    it('respects a custom filter that rejects batch responses', async () => {
      const filter = vi.fn(() => false)

      const handler = createBatchHandler({
        ping: os.handler(() => largeValue),
      }, { filter })

      const { response } = await handler.handle(createBatchRequest('streaming', [
        makePeerRequestMessage(0, '/ping'),
      ]))

      expect(filter).toHaveBeenCalled()
      expect(response!.headers.has('content-encoding')).toBe(false)

      const text = await new Response(response!.body).text()
      expect(text).toContain(largeValue)
    })

    it('supports cancelling a compressed streaming batch response', async () => {
      const handler = createBatchHandler({
        fast: os.handler(() => largeValue),
        never: os.handler(() => new Promise(() => {})),
      })

      const { response } = await handler.handle(createBatchRequest('streaming', [
        makePeerRequestMessage(0, '/fast'),
        makePeerRequestMessage(1, '/never'),
      ]))

      expect(response!.headers.get('content-encoding')).toBe('gzip')

      const reader = response!.body!.getReader()
      const { value } = await reader.read()
      expect(value!.byteLength).toBeGreaterThan(0)

      await expect(reader.cancel()).resolves.toBeUndefined()
    })
  })
})
