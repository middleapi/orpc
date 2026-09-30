import type { StandardLazyResponse } from '@standard-server/core'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor } from '../adapters/standard'
import * as http from 'node:http'
import * as zlib from 'node:zlib'
import { RPCLink } from '@orpc/client/fetch'
import { toArray } from '@orpc/shared'
import { ResponseCompressionLinkPlugin } from './response-compression'

async function compressAsync(data: string, encoding: 'gzip' | 'deflate' | 'deflate-raw'): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(encoding))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

beforeEach(() => {
  vi.clearAllMocks()
})

function toChunkedStream(bytes: Uint8Array<ArrayBuffer>, chunkSize: number): ReadableStream<Uint8Array<ArrayBuffer>> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }

      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

/**
 * Runs the plugin's transport interceptor alone, for checks on the resolved stream itself.
 */
async function intercept(response: StandardLazyResponse): Promise<StandardLazyResponse> {
  const [interceptor] = toArray(new ResponseCompressionLinkPlugin().init({}).transportInterceptors)

  return interceptor!({
    context: {},
    path: ['test'],
    request: { method: 'POST', url: '/rpc/test', headers: {}, body: undefined },
    next: async () => response,
  })
}

function createLink(options: {
  pluginOptions?: ConstructorParameters<typeof ResponseCompressionLinkPlugin>[0]
  plugins?: StandardLinkPlugin<any>[]
  transportInterceptors?: StandardLinkTransportInterceptor<any>[]
  fetchImpl?: (url: string, init: { body: any, headers: Headers }) => Promise<Response>
} = {}) {
  const fetch = vi.fn(
    options.fetchImpl ?? (async (_url: string, _init: { body: any, headers: Headers }) =>
      new Response(JSON.stringify({ json: 'OK' }), { headers: { 'content-type': 'application/json' } })),
  )

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://localhost:3000',
    method: () => 'POST',
    plugins: [
      new ResponseCompressionLinkPlugin(options.pluginOptions),
      ...toArray(options.plugins),
    ],
    transportInterceptors: options.transportInterceptors,
    fetch,
  })

  return { link, fetch }
}

describe('responseCompressionLinkPlugin', () => {
  it('sets accept-encoding on the request when not already present', async () => {
    const { link, fetch } = createLink()

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = fetch.mock.calls[0]!
    expect(init.headers?.get('accept-encoding')).toBe('gzip, deflate')
  })

  it('respects custom encodings option for accept-encoding', async () => {
    const { link, fetch } = createLink({ pluginOptions: { encodings: ['deflate', 'gzip'] } })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = fetch.mock.calls[0]!
    expect(init.headers?.get('accept-encoding')).toBe('deflate, gzip')
  })

  it.each(
    ['gzip', 'deflate', 'deflate-raw'] as const,
  )('decompresses response body when content-encoding is %s', async (encoding) => {
    const payload = JSON.stringify({ json: 'OK' })
    const compressed = await compressAsync(payload, encoding)

    const { link } = createLink({
      fetchImpl: async () => new Response(compressed, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': encoding,
        },
      }),
    })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it('decompresses response body when multiple content-encodings are applied', async () => {
    const payload = JSON.stringify({ json: 'OK' })
    // Content-Encoding: deflate, gzip means gzip applied last
    const deflatedBytes = await compressAsync(payload, 'deflate')
    const gzippedStream = new Blob([deflatedBytes]).stream().pipeThrough(new CompressionStream('gzip'))
    const multiCompressed = new Uint8Array(await new Response(gzippedStream).arrayBuffer())

    const { link } = createLink({
      fetchImpl: async () => new Response(multiCompressed, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'deflate, gzip',
        },
      }),
    })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it('decompresses response body when 5 content-encodings are applied', async () => {
    let body: Uint8Array<ArrayBuffer> = await compressAsync(JSON.stringify({ json: 'OK' }), 'gzip')
    for (let i = 1; i < 5; i++) {
      body = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    }

    const { link } = createLink({
      fetchImpl: async () => new Response(body, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': Array.from({ length: 5 }).fill('gzip').join(', '),
        },
      }),
    })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it('rejects response body when more than 5 content-encodings are applied', async () => {
    const { link } = createLink({
      fetchImpl: async () => new Response('irrelevant', {
        headers: {
          'content-type': 'application/json',
          'content-encoding': Array.from({ length: 6 }).fill('gzip').join(', '),
        },
      }),
    })

    const promise = link.call(['test'], undefined, { context: {} })

    await expect(promise).rejects.toBeInstanceOf(TypeError)
    await expect(promise).rejects.toThrow('Too many content encodings.')
  })

  it('does not decompress when content-encoding is not supported', async () => {
    const payload = JSON.stringify({ json: 'OK' })

    const { link } = createLink({
      fetchImpl: async () => new Response(payload, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'br',
        },
      }),
    })

    // Body is not decompressed; JSON parse still works because body was never compressed
    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it('does not decompress when content-encoding is not set', async () => {
    const { link } = createLink()

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it('does not decompress when any content-encoding in the list is unsupported', async () => {
    const payload = JSON.stringify({ json: 'OK' })
    const compressed = await compressAsync(payload, 'gzip')

    const { link } = createLink({
      fetchImpl: async () => new Response(compressed, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip, br',
        },
      }),
    })

    // Partial decode is skipped; body stays compressed → deserialize fails
    await expect(link.call(['test'], undefined, { context: {} })).rejects.toThrow()
  })

  it.each(
    ['gzip', 'deflate', 'deflate, gzip'] as const,
  )('passes through a body that fetch has already decoded when content-encoding is %s', async (encoding) => {
    const { link } = createLink({
      fetchImpl: async () => new Response(JSON.stringify({ json: 'OK' }), {
        headers: {
          'content-type': 'application/json',
          'content-encoding': encoding,
        },
      }),
    })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it.each(
    ['gzip', 'deflate', 'deflate-raw'] as const,
  )('decompresses a %s body whose signature arrives one byte at a time', async (encoding) => {
    const compressed = await compressAsync(JSON.stringify({ json: 'OK' }), encoding)

    const { link } = createLink({
      fetchImpl: async () => new Response(toChunkedStream(compressed, 1), {
        headers: {
          'content-type': 'application/json',
          'content-encoding': encoding,
        },
      }),
    })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })

  it.each(
    ['gzip', 'deflate', 'deflate-raw'] as const,
  )('passes through an empty body when content-encoding is %s', async (encoding) => {
    const response = await intercept({
      status: 200,
      headers: { 'content-encoding': encoding },
      resolveBody: async () => new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    })

    const body = await response.resolveBody('octet-stream') as ReadableStream<Uint8Array>
    await expect(new Response(body).arrayBuffer()).resolves.toEqual(new ArrayBuffer(0))
  })

  it('does not wait for the first bytes to resolve a streamed body', async () => {
    const response = await intercept({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      resolveBody: async () => new ReadableStream(), // never produces a byte
    })

    await expect(response.resolveBody('octet-stream')).resolves.toBeInstanceOf(ReadableStream)
  })

  it('cancels the source body while waiting for its signature', async () => {
    const cancel = vi.fn()

    const response = await intercept({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      resolveBody: async () => new ReadableStream({ cancel }),
    })

    const reader = (await response.resolveBody('octet-stream') as ReadableStream<Uint8Array>).getReader()
    const read = reader.read()

    await reader.cancel('reason')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('reason')
    await expect(read).resolves.toEqual({ done: true, value: undefined })
  })

  it.each([
    ['already decoded', 'gzip', new TextEncoder().encode('plain text')],
    ['encoded', 'gzip', zlib.gzipSync('compressed text')],
    ['encoded', 'gzip, deflate', zlib.deflateSync(zlib.gzipSync('compressed text'))],
  ] as const)('cancels the source body after checking its signature, for a body that is %s (content-encoding: %s)', async (_, encoding, bytes) => {
    const cancel = vi.fn()

    const response = await intercept({
      status: 200,
      headers: { 'content-encoding': encoding },
      resolveBody: async () => new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
        },
        cancel,
      }),
    })

    const reader = (await response.resolveBody('octet-stream') as ReadableStream<Uint8Array>).getReader()
    await expect(reader.read()).resolves.toMatchObject({ done: false })

    await reader.cancel('reason')

    // piped streams propagate the cancel asynchronously
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(cancel).toHaveBeenCalledWith('reason')
  })

  it('should not decompress when resolveBody returns non-ReadableStream', async () => {
    const mockResponsePlugin: StandardLinkPlugin<any> = {
      name: 'mock-non-stream-response',
      after: ['~response-compression'],
      init(options: StandardLinkOptions<any>): StandardLinkOptions<any> {
        return {
          ...options,
          transportInterceptors: [
            ...toArray(options.transportInterceptors),
            async () => ({
              status: 200,
              headers: {
                'content-type': 'application/json',
                'content-encoding': 'gzip',
              },
              async resolveBody() {
                return { json: 'MOCKED' }
              },
            }),
          ],
        }
      },
    }

    const { link } = createLink({
      plugins: [mockResponsePlugin],
    })

    await expect(link.call(['test'], undefined, { context: {} })).resolves.toEqual('MOCKED')
  })
})

describe('responseCompressionLinkPlugin with fetch against a node:http server', () => {
  const payload = JSON.stringify({ json: 'OK' })

  /**
   * Applies codings in listed order, like the server that sets the Content-Encoding header would.
   */
  function encode(encoding: string): Uint8Array {
    return encoding.split(',').reduce<Uint8Array>((body, coding) => {
      switch (coding.trim()) {
        case 'gzip': return zlib.gzipSync(body)
        case 'deflate': return zlib.deflateSync(body)
        case 'deflate-raw': return zlib.deflateRawSync(body)
        default: throw new Error(`Unexpected coding: ${coding}`)
      }
    }, new TextEncoder().encode(payload))
  }

  let contentEncoding: string
  let requestHeaders: IncomingHttpHeaders | undefined

  const server = http.createServer((req, res) => {
    requestHeaders = req.headers
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': contentEncoding,
    })
    res.end(encode(contentEncoding))
  })

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, resolve))
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  function createRealLink() {
    return new RPCLink({
      url: '/rpc',
      origin: `http://localhost:${(server.address() as AddressInfo).port}`,
      plugins: [new ResponseCompressionLinkPlugin()],
      // default fetch, which decodes gzip and deflate itself but keeps the content-encoding header
    })
  }

  it.each(
    ['gzip', 'deflate', 'deflate, gzip'],
  )('resolves a %s response that fetch has already decoded', async (encoding) => {
    contentEncoding = encoding

    await expect(createRealLink().call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
    expect(requestHeaders?.['accept-encoding']).toBe('gzip, deflate')
  })

  it.each(
    ['deflate-raw', 'gzip, deflate-raw'],
  )('decompresses a %s response that fetch leaves encoded', async (encoding) => {
    contentEncoding = encoding

    await expect(createRealLink().call(['test'], undefined, { context: {} })).resolves.toEqual('OK')
  })
})
