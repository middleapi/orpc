import zlib from 'node:zlib'
import { toArray } from '@orpc/shared'
import { withEventMeta } from '@standard-server/core'
import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
import supertest from 'supertest'
import { RPCHandler } from '../adapters/fetch'
import { RPCHandler as MessagePortRPCHandler } from '../adapters/message-port'
import { RPCHandler as NodeRPCHandler } from '../adapters/node'
import { RPCHandler as WebSocketRPCHandler } from '../adapters/websocket'
import { os } from '../builder'
import { RequestCompressionHandlerPlugin } from './request-compression'
import { RequestLimitHandlerPlugin } from './request-limit'

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

  describe('with decoded bodies', () => {
    const streamHandler = async ({ input }: { input: unknown }) => {
      let count = 0

      for await (const _ of input as AsyncIterable<unknown>) {
        count++
      }

      return count
    }

    /**
     * Mimics an adapter that ignores the `octet-stream` hint and returns an
     * already decoded body, like peer adapters do.
     */
    const createHandler = (maxBodySize: number, body: () => unknown, handler: (options: any) => unknown = procedureHandler) => new RPCHandler(
      os.handler(handler),
      {
        plugins: [
          new RequestLimitHandlerPlugin({ maxBodySize }),
          {
            name: 'decoded-body',
            init: options => ({
              ...options,
              routingInterceptors: [
                async ({ next, ...interceptorOptions }) => next({
                  ...interceptorOptions,
                  request: { ...interceptorOptions.request, resolveBody: async () => body() as any },
                }),
                ...toArray(options.routingInterceptors),
              ],
            }),
          },
        ],
      },
    )

    const send = (handler: RPCHandler<any>) => handler.handle(new Request('https://example.com', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    }))

    it('measures a JSON body by its encoded size, the same as over HTTP', async () => {
      const allowed = await send(createHandler(22, () => size22Json))

      await expect(allowed.response!.text()).resolves.toContain('ping')
      expect(allowed.response!.status).toBe(200)
      expect(procedureHandler).toHaveBeenCalledWith(expect.any(Object), { foo: 'bar' })

      procedureHandler.mockClear()

      const rejected = await send(createHandler(21, () => size22Json))

      await expect(rejected.response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
      expect(rejected.response!.status).toBe(413)
      expect(procedureHandler).not.toHaveBeenCalled()
    })

    it.each([
      ['string', 'x'.repeat(101)],
      ['file', new File(['x'.repeat(101)], 'a.txt')],
      ['bytes', new Uint8Array(101)],
      ['form data', (() => {
        const form = new FormData()
        form.set('data', '{}')
        form.set('file', new File(['x'.repeat(101)], 'a.txt'))
        return form
      })()],
      ['url search params', new URLSearchParams({ data: 'x'.repeat(101) })],
      ['map', new Map([['key', 'x'.repeat(101)]])],
    ])('rejects an oversized %s body', async (_, body) => {
      const { response } = await send(createHandler(100, () => body))

      await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
      expect(response!.status).toBe(413)
      expect(procedureHandler).not.toHaveBeenCalled()
    })

    it('counts a value reachable more than once only once and tolerates cycles', async () => {
      const shared = { json: 'x'.repeat(40) }
      const cyclic: Record<string, unknown> = { json: 'x' }
      cyclic.self = cyclic

      const allowedShared = await send(createHandler(100, () => [shared, shared, shared]))
      expect(allowedShared.response!.status).toBe(200)

      const allowedCyclic = await send(createHandler(100, () => cyclic))
      expect(allowedCyclic.response!.status).toBe(200)

      cyclic.json = 'x'.repeat(100)
      const rejectedCyclic = await send(createHandler(100, () => cyclic))
      expect(rejectedCyclic.response!.status).toBe(413)
    })

    it('limits an async iterator body by the total size of the values read', async () => {
      const yielded = vi.fn()
      const body = async function* () {
        for (let i = 0; i < 100; i++) {
          yielded()
          yield { json: 'x'.repeat(100) } // 111 bytes
        }
      }

      const { response } = await send(createHandler(1000, body, streamHandler))

      await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
      expect(response!.status).toBe(413)
      expect(yielded).toHaveBeenCalledTimes(10)
    })

    it('allows an async iterator body within the limit', async () => {
      const body = async function* () {
        for (let i = 0; i < 9; i++) {
          yield { json: 'x'.repeat(100) } // 111 bytes
        }
      }

      const { response } = await send(createHandler(1000, body, streamHandler))

      await expect(response!.text()).resolves.toContain('9')
      expect(response!.status).toBe(200)
    })

    it('counts event meta toward the async iterator limit', async () => {
      const body = async function* () {
        for (let i = 0; i < 3; i++) {
          yield withEventMeta({ json: i }, { comments: ['x'.repeat(400)] })
        }
      }

      const { response } = await send(createHandler(1000, body, streamHandler))

      await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
      expect(response!.status).toBe(413)
    })
  })

  describe('with peer adapters', () => {
    const received = vi.fn()
    const router = {
      big: os.handler(({ input }) => {
        received(input)
        return String(input).length
      }),
      stream: os.handler(async ({ input }) => {
        for await (const value of input as AsyncIterable<unknown>) {
          received(value)
        }

        return 'done'
      }),
    }

    const createWs = () => {
      const sent: any[] = []
      const ws = {
        send: (data: string | Uint8Array<ArrayBuffer>) => {
          sent.push((decodePeerMessage(data) as any).message)
        },
      }

      return { ws, sent }
    }

    it('rejects a single oversized WebSocket message', async () => {
      const handler = new WebSocketRPCHandler(router, {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 100 })],
      })
      const { ws, sent } = createWs()

      await handler.message(ws, await encodePeerMessage({
        id: '1',
        kind: 'request',
        json: { url: '/big', body: { json: 'x'.repeat(100_000) } },
      }))

      expect(received).not.toHaveBeenCalled()
      expect(sent).toEqual([expect.objectContaining({ id: '1', kind: 'response', json: expect.objectContaining({ status: 413 }) })])
      expect(sent[0].json.body.json.code).toBe('PAYLOAD_TOO_LARGE')
    })

    it('applies the same limit to a WebSocket JSON body as over HTTP', async () => {
      const send = async (maxBodySize: number) => {
        const handler = new WebSocketRPCHandler(router, {
          plugins: [new RequestLimitHandlerPlugin({ maxBodySize })],
        })
        const { ws, sent } = createWs()

        await handler.message(ws, await encodePeerMessage({
          id: '1',
          kind: 'request',
          json: { url: '/big', body: size22Json },
        }))

        return sent[0].json.status ?? 200
      }

      await expect(send(22)).resolves.toBe(200)
      await expect(send(21)).resolves.toBe(413)
    })

    it('rejects a WebSocket event stream once the values read exceed the limit', async () => {
      const handler = new WebSocketRPCHandler(router, {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 1000 })],
      })
      const { ws, sent } = createWs()

      const request = handler.message(ws, await encodePeerMessage({
        id: '1',
        kind: 'request',
        json: { url: '/stream', headers: { 'standard-server': 'event-stream' } },
      }))

      for (let i = 0; i < 1000; i++) {
        await handler.message(ws, await encodePeerMessage({
          id: '1',
          kind: 'event-stream',
          json: { data: { json: 'x'.repeat(100) } }, // 111 bytes each
        }))
      }

      await handler.message(ws, await encodePeerMessage({ id: '1', kind: 'event-stream', json: { event: 'close' } }))
      await request

      expect(received).toHaveBeenCalledTimes(9)
      expect(sent).toContainEqual({ id: '1', kind: 'stream/cancel' })

      const response = sent.find(message => message.kind === 'response')
      expect(response.json.status).toBe(413)
      expect(response.json.body.json.code).toBe('PAYLOAD_TOO_LARGE')
    })

    it('allows a WebSocket event stream within the limit', async () => {
      const handler = new WebSocketRPCHandler(router, {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 1000 })],
      })
      const { ws, sent } = createWs()

      const request = handler.message(ws, await encodePeerMessage({
        id: '1',
        kind: 'request',
        json: { url: '/stream', headers: { 'standard-server': 'event-stream' } },
      }))

      for (let i = 0; i < 9; i++) {
        await handler.message(ws, await encodePeerMessage({
          id: '1',
          kind: 'event-stream',
          json: { data: { json: 'x'.repeat(100) } }, // 111 bytes each
        }))
      }

      await handler.message(ws, await encodePeerMessage({ id: '1', kind: 'event-stream', json: { event: 'close' } }))
      await request

      expect(received).toHaveBeenCalledTimes(9)
      expect(sent).toEqual([expect.objectContaining({ id: '1', kind: 'response', json: expect.objectContaining({ body: { json: 'done' } }) })])
    })

    it('rejects an oversized structured-clone MessagePort message', async () => {
      const handler = new MessagePortRPCHandler(router, {
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize: 100 })],
      })
      const { port1 } = new MessageChannel()
      const posted: any[] = []
      vi.spyOn(port1, 'postMessage').mockImplementation(message => posted.push(message))

      await handler.message(port1, {
        id: '1',
        kind: 'request',
        json: { url: '/big', body: { json: 'x'.repeat(100_000) } },
      })

      port1.close()

      expect(received).not.toHaveBeenCalled()
      expect((decodePeerMessage(posted[0]) as any).message.json.status).toBe(413)
    })
  })
})
