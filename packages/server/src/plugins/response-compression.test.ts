import supertest from 'supertest'
import { RPCHandler } from '../adapters/fetch'
import { RPCHandler as NodeRPCHandler } from '../adapters/node'
import { os } from '../builder'
import { ResponseCompressionHandlerPlugin } from './response-compression'

async function decompressStream(stream: ReadableStream, encoding: 'gzip' | 'deflate' | 'deflate-raw'): Promise<string> {
  const decompressed = stream.pipeThrough(new DecompressionStream(encoding))
  return new Response(decompressed).text()
}

describe('responseCompressionHandlerPlugin', () => {
  describe('unmatched', () => {
    it('returns unmatched results without modifying them', async () => {
      const handler = new RPCHandler({}, {
        plugins: [
          new ResponseCompressionHandlerPlugin(),
        ],
      })

      const result = await handler.handle(new Request('https://example.com/unmatched', {
        headers: {
          'accept-encoding': 'gzip',
        },
      }))

      expect(result).toEqual({ matched: false })
    })
  })

  describe('accept-encoding / encodings', () => {
    it('does not compress when the client does not accept compression', async () => {
      const largeText = 'x'.repeat(2000)
      const handler = new RPCHandler(os.handler(() => largeText), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
      await expect(response!.json()).resolves.toEqual({ json: largeText })
    })

    it('does not compress when accept-encoding has no supported coding', async () => {
      const handler = new RPCHandler(os.handler(() => 'x'.repeat(2000)), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'br, zstd',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('prefers the first configured encoding the client accepts', async () => {
      const handler = new RPCHandler(os.handler(() => 'x'.repeat(2000)), {
        plugins: [
          new ResponseCompressionHandlerPlugin({
            encodings: ['deflate', 'gzip'],
            threshold: 100,
          }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip, deflate',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('deflate')
    })

    it('ignores q-values when parsing accept-encoding', async () => {
      const largeText = 'x'.repeat(2000)
      const handler = new RPCHandler(os.handler(() => largeText), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ encodings: ['gzip'], threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip;q=0.8, identity;q=0.5',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toBe(JSON.stringify({ json: largeText }))
    })

    it('skips empty tokens in accept-encoding', async () => {
      const handler = new RPCHandler(os.handler(() => 'x'.repeat(2000)), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': ' , gzip , ',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
    })
  })

  describe('content-encoding header', () => {
    it('does not compress when content-encoding is already set', async () => {
      const handler = new RPCHandler(os.handler(() => 'x'.repeat(2000)), {
        plugins: [
          {
            name: 'set-content-encoding',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'content-encoding': 'br',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('br')
    })
  })

  describe('cache-control header', () => {
    it('does not compress when cache-control includes no-transform', async () => {
      const largeText = 'x'.repeat(2000)
      const handler = new RPCHandler(os.handler(() => largeText), {
        plugins: [
          {
            name: 'set-cache-control',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'cache-control': 'public, no-transform',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
      await expect(response!.json()).resolves.toEqual({ json: largeText })
    })
  })

  describe('json body', () => {
    it.each(
      ['gzip', 'deflate', 'deflate-raw'] as const,
    )('compresses large JSON responses with %s when the client accepts it', async (encoding) => {
      const largeText = 'x'.repeat(2000)
      const handler = new RPCHandler(os.handler(() => largeText), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ encodings: [encoding], threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': encoding,
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe(encoding)
      expect(response!.headers.get('content-type')).toBe('application/json')
      expect(response!.headers.has('content-length')).toBe(false)

      await expect(
        decompressStream(response!.body!, encoding),
      ).resolves.toBe(JSON.stringify({ json: largeText }))
    })

    it('does not compress JSON responses below the configured threshold', async () => {
      const smallText = 'small response'
      const handler = new RPCHandler(os.handler(() => smallText), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 1024 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
      await expect(response!.json()).resolves.toEqual({ json: smallText })
    })
  })

  describe('blob body', () => {
    it('should compress blob body above threshold', async () => {
      const largeBlob = new Blob(['large content'.repeat(100)], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => largeBlob), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.body).toBeInstanceOf(ReadableStream)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-type')).toBe('text/plain')
      expect(response!.headers.has('content-length')).toBe(false)
      expect(response!.headers.get('content-disposition')).toContain('blob')

      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toEqual(await largeBlob.text())
    })

    it('should not compress blob body below threshold', async () => {
      const smallBlob = new Blob(['small content'], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => smallBlob), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
      await expect(response!.text()).resolves.toBe('small content')
    })

    it('should not compress unsupported content-type blob', async () => {
      const imageBlob = new Blob(['large content'.repeat(100)], { type: 'image/png' })
      const handler = new RPCHandler(os.handler(() => imageBlob), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('should respect existing content-disposition header for compressed blob body', async () => {
      const largeBlob = new Blob(['large content'.repeat(100)], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => largeBlob), {
        plugins: [
          {
            name: 'set-content-disposition',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'content-disposition': '__CUSTOM__',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-disposition')).toBe('__CUSTOM__')
    })

    it('should use file name in content-disposition for File body', async () => {
      const file = new File(['large content'.repeat(100)], 'my-file.txt', { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => file), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-disposition')).toContain('my-file.txt')
    })

    it('should compress blob body when size is unknown', async () => {
      class NaNSizeBlob extends Blob {
        override get size() {
          return Number.NaN
        }
      }

      const blob = new NaNSizeBlob(['small'], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => blob), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 1000 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
    })

    it('should not compress blob body when size is unknown and content-type is non-compressible', async () => {
      class NaNSizeBlob extends Blob {
        override get size() {
          return Number.NaN
        }
      }

      const blob = new NaNSizeBlob(['small'], { type: 'image/png' })
      const handler = new RPCHandler(os.handler(() => blob), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 1000 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })
  })

  describe('readable stream body', () => {
    it('should compress ReadableStream body above threshold with compressible content-type', async () => {
      const payload = 'large content'.repeat(100)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        },
      })

      const handler = new RPCHandler(os.handler(() => stream), {
        plugins: [
          {
            name: 'set-stream-headers',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'content-type': 'text/plain',
                          'content-length': '200',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.body).toBeInstanceOf(ReadableStream)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-type')).toBe('text/plain')
      expect(response!.headers.has('content-length')).toBe(false)

      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toEqual(payload)
    })

    it('should not compress ReadableStream body below threshold', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('small'))
          controller.close()
        },
      })

      const handler = new RPCHandler(os.handler(() => stream), {
        plugins: [
          {
            name: 'set-stream-headers',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'content-type': 'text/plain',
                          'content-length': '50',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('should not compress ReadableStream body with non-compressible content-type', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('large content'.repeat(100)))
          controller.close()
        },
      })

      const handler = new RPCHandler(os.handler(() => stream), {
        plugins: [
          {
            name: 'set-stream-headers',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'content-type': 'image/png',
                          'content-length': '200',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('should compress ReadableStream body when content-length is unknown with compressible content-type', async () => {
      const payload = 'large content'.repeat(100)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        },
      })

      const handler = new RPCHandler(os.handler(() => stream), {
        plugins: [
          {
            name: 'set-stream-headers',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        headers: {
                          ...result.response.headers,
                          'content-type': 'text/plain',
                        },
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.has('content-length')).toBe(false)

      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toEqual(payload)
    })
  })

  describe('form data body', () => {
    it('should compress FormData body above threshold with blob field', async () => {
      const blob = new Blob(['large content'.repeat(100)], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => ({ file: blob })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.body).toBeInstanceOf(ReadableStream)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-type')).toMatch(/^multipart\/form-data/)
      expect(response!.headers.has('content-length')).toBe(false)
    })

    it('should compress FormData body above threshold with string field', async () => {
      const form = new FormData()
      form.set('value', 'a'.repeat(100))

      const handler = new RPCHandler(os.handler(() => 'ok'), {
        plugins: [
          {
            name: 'set-form-data-body',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        body: form,
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-type')).toMatch(/^multipart\/form-data/)
    })

    it('should not compress FormData body below threshold', async () => {
      const blob = new Blob(['x'], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => ({ file: blob })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 1000 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('should not compress FormData body when non-compressible blob keeps score below threshold', async () => {
      const blob = new Blob(['large content'.repeat(100)], { type: 'image/png' })
      const handler = new RPCHandler(os.handler(() => ({ file: blob })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 500 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('should compress FormData when compressible data outweighs non-compressible blob', async () => {
      const text = new Blob(['a'.repeat(500)], { type: 'text/plain' })
      const image = new Blob(['x'.repeat(50)], { type: 'image/png' })
      const handler = new RPCHandler(os.handler(() => ({ text, image })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-type')).toMatch(/^multipart\/form-data/)
    })

    it('should not compress FormData when non-compressible blob outweighs compressible data', async () => {
      const text = new Blob(['hi'], { type: 'text/plain' })
      const image = new Blob(['x'.repeat(2000)], { type: 'image/png' })
      const handler = new RPCHandler(os.handler(() => ({ text, image })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 500 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })

    it('should compress FormData when NaN-size compressible blob is present (without non-compressible NaN-size blobs)', async () => {
      class NaNSizeBlob extends Blob {
        override get size() {
          return Number.NaN
        }
      }

      const blob1 = new NaNSizeBlob(['content'], { type: 'text/plain' })
      const blob2 = new Blob(['content'.repeat(100)], { type: 'image/png' })

      const handler = new RPCHandler(os.handler(() => ({ blob1, blob2 })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 1000 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
    })

    it('should not compress FormData when a NaN-size non-compressible blob is present (even with NaN-size compressible blobs)', async () => {
      class NaNSizeBlob extends Blob {
        override get size() {
          return Number.NaN
        }
      }

      const blob1 = new NaNSizeBlob(['content'.repeat(1)], { type: 'image/png' })
      const blob2 = new NaNSizeBlob(['content'.repeat(100)], { type: 'text/plain' })
      const handler = new RPCHandler(os.handler(() => ({ blob1, blob2 })), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 1000 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })
  })

  describe('url search params body', () => {
    it('should compress URLSearchParams body above threshold', async () => {
      const params = new URLSearchParams({ value: 'a'.repeat(100) })
      const handler = new RPCHandler(os.handler(() => 'ok'), {
        plugins: [
          {
            name: 'set-url-search-params-body',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        body: params,
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.body).toBeInstanceOf(ReadableStream)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect(response!.headers.has('content-length')).toBe(false)

      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toEqual(`value=${encodeURIComponent('a'.repeat(100))}`)
    })

    it('should not compress URLSearchParams body below threshold', async () => {
      const params = new URLSearchParams({ value: 'hi' })
      const handler = new RPCHandler(os.handler(() => 'ok'), {
        plugins: [
          {
            name: 'set-url-search-params-body',
            init(options) {
              return {
                ...options,
                routingInterceptors: [
                  async ({ next, ...interceptorOptions }) => {
                    const result = await next(interceptorOptions)
                    if (!result.matched) {
                      return result
                    }
                    return {
                      ...result,
                      response: {
                        ...result.response,
                        body: params,
                      },
                    }
                  },
                  ...options.routingInterceptors ?? [],
                ],
              }
            },
          },
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
    })
  })

  describe('async iterator body', () => {
    it('should not compress async iterator body', async () => {
      const handler = new RPCHandler(
        os.handler(async function* () {
          yield 'yield1'
          yield 'yield2'
        }),
        {
          plugins: [
            new ResponseCompressionHandlerPlugin({ threshold: 0 }),
          ],
        },
      )

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.has('content-encoding')).toBe(false)
      expect(response!.headers.get('content-type')).toBe('text/event-stream')
    })
  })

  describe('threshold option', () => {
    it('defaults to 1024 bytes', async () => {
      const largeText = 'x'.repeat(2000)
      const handler = new RPCHandler(os.handler(() => largeText), {
        plugins: [
          new ResponseCompressionHandlerPlugin(),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')

      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toBe(JSON.stringify({ json: largeText }))
    })

    it('always compresses when threshold is 0', async () => {
      const smallText = 'a'
      const handler = new RPCHandler(os.handler(() => smallText), {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 0 }),
        ],
      })

      const { matched, response } = await handler.handle(new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip',
        },
        body: JSON.stringify({ json: null }),
      }))

      expect(matched).toBe(true)
      expect(response!.headers.get('content-encoding')).toBe('gzip')

      await expect(
        decompressStream(response!.body!, 'gzip'),
      ).resolves.toBe(JSON.stringify({ json: smallText }))
    })
  })

  describe('node adapter', () => {
    it('should work with Node.js adapter', async () => {
      const largeText = 'x'.repeat(2000)
      const procedure = os.handler(() => largeText)
      const nodeHandler = new NodeRPCHandler(procedure, {
        plugins: [
          new ResponseCompressionHandlerPlugin({ threshold: 100 }),
        ],
      })

      const server = supertest((req: any, res: any) => {
        nodeHandler.handle(req, res)
      })

      const response = await server.post('/')
        .set('accept-encoding', 'gzip')
        .set('content-type', 'application/json')
        .send({ json: null })

      expect(response.status).toBe(200)
      expect(response.headers['content-encoding']).toBe('gzip')
      // superagent auto-decompresses the body
      expect(response.text).toContain(largeText)
    })
  })
})
