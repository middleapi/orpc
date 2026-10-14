import type { StandardLazyRequest } from '@standard-server/core'
import zlib from 'node:zlib'
import supertest from 'supertest'
import { RPCHandler } from '../adapters/fetch'
import { RPCHandler as NodeRPCHandler } from '../adapters/node'
import { os } from '../builder'
import { RequestCompressionHandlerPlugin } from './request-compression'
import { RequestLimitHandlerPlugin, toLimitedResolveBody } from './request-limit'

describe('requestLimitHandlerPlugin', () => {
  const size22Json = { json: { foo: 'bar' } }
  const procedureHandler = vi.fn(() => 'ping')
  const procedure = os.handler(procedureHandler)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores requests without a body', async () => {
    const handler = new RPCHandler(
      {
        ping: procedure,
      },
      {
        allowMethods: ['GET'], // this test sends a GET request
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 22 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping?data=%7B%7D'))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('ping')
    expect(response!.status).toBe(200)
  })

  it('allows bodies within the limit', async () => {
    const handler = new RPCHandler(
      {
        ping: procedure,
      },
      {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 22 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(size22Json),
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('ping')
    expect(response!.status).toBe(200)
  })

  it('rejects when content-length exceeds the limit', async () => {
    const handler = new RPCHandler(
      {
        ping: procedure,
      },
      {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-length': '22',
      },
      body: JSON.stringify({}),
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
    expect(response!.status).toBe(413)
    expect(procedureHandler).not.toHaveBeenCalled()
  })

  it('rejects when the streamed body exceeds the limit', async () => {
    const handler = new RPCHandler(
      {
        ping: procedure,
      },
      {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(size22Json),
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
    expect(response!.status).toBe(413)
    expect(procedureHandler).not.toHaveBeenCalled()
  })

  it('does not limit when resolveBody returns a non-ReadableStream', async () => {
    const handler = new RPCHandler(procedure, {
      plugins: [
        new RequestLimitHandlerPlugin({ maxBodySize: 1 }),
        {
          name: 'test-plugin',
          init(options) {
            return {
              ...options,
              routingInterceptors: [
                async ({ next, ...interceptorOptions }) => {
                  return next({
                    ...interceptorOptions,
                    request: {
                      ...interceptorOptions.request,
                      async resolveBody() {
                        return { json: '__MOCKED__' }
                      },
                    },
                  })
                },
                ...options.routingInterceptors ?? [],
              ],
            }
          },
        },
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    }))

    expect(response?.status).toBe(200)
    expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), '__MOCKED__')
  })

  it('works with the Node.js adapter', async () => {
    const nodeHandler = new NodeRPCHandler(
      {
        ping: procedure,
      },
      {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const server = supertest((req: any, res: any) => {
      nodeHandler.handle(req, res)
    })

    const response = await server.post('/ping')
      .set('content-type', 'application/json')
      .send(size22Json)

    expect(response.status).toBe(413)
    expect(response.text).toContain('PAYLOAD_TOO_LARGE')
    expect(procedureHandler).not.toHaveBeenCalled()
  })

  describe('with RequestCompressionHandlerPlugin', () => {
    it('applies the limit after decompression', async () => {
      // Highly compressible: small on the wire, large after decompression.
      const payload = JSON.stringify({ json: 'a'.repeat(10_000) })
      const compressed = zlib.gzipSync(payload)
      const maxBodySize = 5_000

      expect(compressed.byteLength).toBeLessThan(maxBodySize)
      expect(payload.length).toBeGreaterThan(maxBodySize)

      const handler = new RPCHandler(
        {
          ping: procedure,
        },
        {
          plugins: [
            new RequestLimitHandlerPlugin({ maxBodySize }),
            new RequestCompressionHandlerPlugin(),
          ],
        },
      )

      const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
        method: 'POST',
        headers: {
          'content-encoding': 'gzip',
          'content-type': 'application/json',
        },
        body: compressed,
      }))

      expect(matched).toBe(true)
      await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
      expect(response!.status).toBe(413)
      expect(procedureHandler).not.toHaveBeenCalled()
    })

    it('allows decompressed bodies within the limit', async () => {
      const payload = JSON.stringify(size22Json)
      const compressed = zlib.gzipSync(payload)

      const handler = new RPCHandler(
        {
          ping: procedure,
        },
        {
          plugins: [
            new RequestLimitHandlerPlugin({ maxBodySize: 1024 }),
            new RequestCompressionHandlerPlugin(),
          ],
        },
      )

      const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
        method: 'POST',
        headers: {
          'content-encoding': 'gzip',
          'content-type': 'application/json',
        },
        body: compressed,
      }))

      expect(matched).toBe(true)
      await expect(response!.text()).resolves.toContain('ping')
      expect(response!.status).toBe(200)
    })
  })
})

describe('toLimitedResolveBody', () => {
  function toStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array<ArrayBuffer>> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(chunk))
        controller.close()
      },
    }) as ReadableStream<Uint8Array<ArrayBuffer>>
  }

  it('rejects before reading the body when content-length exceeds the limit', async () => {
    const resolveBody = vi.fn()
    const limited = toLimitedResolveBody({ headers: { 'content-length': '11' }, resolveBody }, 10)

    await expect(limited()).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(resolveBody).not.toHaveBeenCalled()
  })

  it('decodes the body with the given hint or the request headers', async () => {
    const request = {
      headers: { 'content-type': 'application/json' },
      resolveBody: vi.fn(async () => toStream(new TextEncoder().encode('{"a":1}'))),
    }

    await expect(toLimitedResolveBody(request, 10)()).resolves.toEqual({ a: 1 })
    await expect(toLimitedResolveBody(request, 10)('url-search-params')).resolves.toEqual(new URLSearchParams('{"a":1}'))
    expect(request.resolveBody).toHaveBeenCalledWith('octet-stream')
  })

  it('resolves the limited stream itself for the octet-stream hint', async () => {
    const limited = toLimitedResolveBody({
      headers: {},
      resolveBody: async () => toStream(new Uint8Array(6), new Uint8Array(6)),
    }, 10)

    const stream = await limited('octet-stream') as ReadableStream<Uint8Array>
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ done: false })
    await expect(reader.read()).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
  })

  it('can replace the resolveBody it wraps', async () => {
    const request: Pick<StandardLazyRequest, 'headers' | 'resolveBody'> = {
      headers: {},
      async resolveBody() {
        expect(this).toBe(request)
        return toStream(new Uint8Array(3))
      },
    }

    request.resolveBody = toLimitedResolveBody(request, 10)

    const stream = await request.resolveBody('octet-stream')
    expect(stream).toBeInstanceOf(ReadableStream)
  })
})
