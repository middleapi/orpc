import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import supertest from 'supertest'
import { RPCHandler } from '../adapters/fetch'
import { RPCHandler as NodeRPCHandler } from '../adapters/node'
import { os } from '../builder'
import { RequestCompressionHandlerPlugin } from './request-compression'

function compress(data: string | Uint8Array, encoding: 'gzip' | 'deflate' | 'deflate-raw'): Buffer {
  const buffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer)

  const compressFn = encoding === 'gzip'
    ? zlib.gzipSync
    : encoding === 'deflate'
      ? zlib.deflateSync
      : zlib.deflateRawSync

  return compressFn(buffer)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestCompressionHandlerPlugin', () => {
  const procedureHandler = vi.fn()
  const procedure = os.handler(procedureHandler)
  const handler = new RPCHandler(procedure, {
    plugins: [
      new RequestCompressionHandlerPlugin(),
    ],
  })

  it.each(
    ['gzip', 'deflate', 'deflate-raw'] as const,
  )('should decompress request body when content-encoding is %s', async (encoding) => {
    const { response } = await handler.handle(new Request('http://localhost', {
      method: 'POST',
      headers: {
        'content-encoding': encoding,
        'content-type': 'application/json',
      },
      body: compress(JSON.stringify({ json: 'input' }), encoding),
    }))

    expect(response?.status).toBe(200)
    expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), 'input')
  })

  it('should not decompress request body when content-encoding is not supported', async () => {
    const { response } = await handler.handle(new Request('http://localhost', {
      method: 'POST',
      headers: {
        'content-encoding': 'unsupported-encoding',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ json: 'input' }),
    }))

    expect(response?.status).toBe(200)
    expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), 'input')
  })

  it('should not decompress request body when content-encoding is not set', async () => {
    const { response } = await handler.handle(new Request('http://localhost', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ json: 'input' }),
    }))

    expect(response?.status).toBe(200)
    expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), 'input')
  })

  it('should not decompress request body when resolveBody return non-ReadableStream', async () => {
    const handler = new RPCHandler(procedure, {
      plugins: [
        new RequestCompressionHandlerPlugin(),
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
        'content-encoding': 'gzip',
      },
    }))

    expect(response?.status).toBe(200)
    expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), '__MOCKED__')
  })

  it('should work with Node.js adapter', async () => {
    const nodeHandler = new NodeRPCHandler(procedure, {
      plugins: [
        new RequestCompressionHandlerPlugin(),
      ],
    })

    const server = supertest((req: any, res: any) => {
      nodeHandler.handle(req, res)
    })

    const response = await server.post('/')
      .set('content-encoding', 'gzip')
      .set('content-type', 'application/octet-stream')
      .set('standard-server', 'json')
      .send(zlib.gzipSync(JSON.stringify({ json: 'input' })))
      .buffer(true)

    expect(response.status).toBe(200)
    expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), 'input')
  })
})
