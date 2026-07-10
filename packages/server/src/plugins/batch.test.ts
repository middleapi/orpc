import type { AnyRouter } from '../router'
import { promiseWithResolvers } from '@orpc/shared'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'

beforeEach(() => {
  vi.clearAllMocks()
})

function makePeerRequestMessage(id: number, url: string, method = 'POST', body?: unknown) {
  return {
    kind: 'request',
    id,
    json: { method, url, headers: {}, body },
    binary: undefined,
  }
}

function createBatchRequest(options: {
  mode: 'buffered' | 'streaming'
  messages?: unknown
  method?: 'POST' | 'GET'
  data?: string
}) {
  if (options.method === 'GET') {
    const search = options.data === undefined ? '' : `?data=${options.data}`

    return new Request(`https://example.com/__batch__${search}`, {
      method: 'GET',
      headers: { 'orpc-batch': options.mode },
    })
  }

  return new Request('https://example.com/__batch__', {
    method: 'POST',
    headers: { 'orpc-batch': options.mode, 'content-type': 'application/json' },
    body: JSON.stringify(options.messages),
  })
}

function readLengthPrefixedChunk(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, 4)
  const messageLength = view.getUint32(0, false)

  return {
    messageLength,
    payload: buffer.slice(4, 4 + messageLength),
  }
}

describe('batchHandlerPlugin', () => {
  const handlerFn = vi.fn(() => 'pong')
  const router = {
    ping: os.handler(handlerFn),
  }

  const createHandler = (
    plugin = new BatchHandlerPlugin(),
    handlerRouter: AnyRouter = router,
  ) => new RPCHandler(handlerRouter, {
    plugins: [plugin],
  })

  it('passes through non-batch requests', async () => {
    const handler = createHandler()

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
    }))

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    expect(handlerFn).toHaveBeenCalledTimes(1)
  })

  describe('buffered mode', () => {
    it('handles buffered batch POST requests', async () => {
      const handler = createHandler()
      const peerMessages = [
        makePeerRequestMessage(0, '/ping'),
        makePeerRequestMessage(1, '/ping'),
      ]

      const { matched, response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: peerMessages,
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)
      expect(handlerFn).toHaveBeenCalledTimes(2)
    })

    it('returns binary payload in buffered mode when sub-response contains binary', async () => {
      const binaryRouter = {
        file: os.handler(() => new Blob([new Uint8Array([1, 2, 3])], {
          type: 'application/octet-stream',
        })),
        ping: os.handler(() => 'pong'),
      }

      const handler = createHandler(new BatchHandlerPlugin(), binaryRouter)

      const peerMessages = [
        makePeerRequestMessage(0, '/file'),
        makePeerRequestMessage(1, '/ping'),
      ]

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: peerMessages,
      }))

      expect(response!.status).toBe(207)
      expect(response!.headers.get('standard-server')).toEqual('file')

      const buffer = new Uint8Array(await response!.arrayBuffer())
      expect(buffer.length).toBeGreaterThan(4)

      const { messageLength, payload } = readLengthPrefixedChunk(buffer)
      expect(messageLength).toBe(payload.length)
    })

    it('handles unmatched sub-requests as 404', async () => {
      const handler = createHandler()

      const { matched, response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/nonexistent')],
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ kind: 'response', id: 0 })
      expect(body[0].json.status).toBe(404)
    })

    it('returns 400 for invalid batch body', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: 'not-an-array',
      }))

      expect(response!.status).toBe(400)
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 413 when batch size exceeds maxSize', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ maxSize: 1 }))
      const peerMessages = [
        makePeerRequestMessage(0, '/ping'),
        makePeerRequestMessage(1, '/ping'),
      ]

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: peerMessages,
      }))

      expect(response!.status).toBe(413)
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 500 sub-response when mapSubrequest throws', async ({ onTestFinished }) => {
      const rejectSpy = vi.spyOn(Promise, 'reject')
        .mockImplementation(() => new Promise(() => {}) as Promise<never>)

      onTestFinished(() => {
        rejectSpy.mockRestore()
      })

      const handler = createHandler(new BatchHandlerPlugin({
        mapSubrequest: () => {
          throw new Error('boom')
        },
      }))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(body[0].json.status).toBe(500)
      expect(body[0].json.body).toBe('Internal server error')
      expect(rejectSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('streaming mode', () => {
    it('handles streaming batch POST requests returning readable stream', async () => {
      const handler = createHandler()
      const peerMessages = [makePeerRequestMessage(0, '/ping')]

      const { matched, response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: peerMessages,
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)
      expect(response!.headers.get('standard-server')).toEqual('octet-stream')

      expect(handlerFn).toHaveBeenCalledTimes(0)

      // Verify the binary format: 4-byte length prefix + encoded peer message.
      const buffer = new Uint8Array(await response!.arrayBuffer())
      expect(buffer.length).toBeGreaterThan(4)

      // Streaming batch is non-blocking; handler resolves while stream is consumed.
      expect(handlerFn).toHaveBeenCalledTimes(1)

      const { messageLength } = readLengthPrefixedChunk(buffer)
      expect(buffer.length).toBe(4 + messageLength)
    })

    it('encodes streaming batch response as binary when sub-response is a blob', async () => {
      const binaryRouter = {
        file: os.handler(() => new Blob(['__TEST__'], {
          type: 'application/octet-stream',
        })),
      }

      const handler = createHandler(new BatchHandlerPlugin(), binaryRouter)

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/file')],
      }))

      expect(response!.status).toBe(207)

      const buffer = new Uint8Array(await response!.arrayBuffer())
      expect(buffer.length).toBeGreaterThan(4)

      const { messageLength, payload } = readLengthPrefixedChunk(buffer)
      expect(messageLength).toBe(payload.length)
      expect(new TextDecoder().decode(payload)).toContain('__TEST__')
    })
  })

  describe('get batches', () => {
    it('handles batch GET requests via query param', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify([
        makePeerRequestMessage(0, '/ping', 'GET'),
      ]))

      const { matched, response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'GET',
        data,
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)
    })

    it('returns 400 for invalid GET data param', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'GET',
        data: 'invalid-json',
      }))

      expect(response!.status).toBe(400)
    })

    it('returns 400 when GET batch request misses data param', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'GET',
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Missing data parameter')
    })

    it('returns 400 for GET batch data that is valid JSON but not an array', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify({ not: 'an-array' }))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'GET',
        data,
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Invalid batch request data parameter')
    })
  })

  describe('configuration options', () => {
    it('supports custom successStatus', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ successStatus: 200 }))
      const peerMessages = [makePeerRequestMessage(0, '/ping')]

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: peerMessages,
      }))

      expect(response!.status).toBe(200)
    })
  })

  describe('keepAlive', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sends zero-length keep-alive frames while the stream is idle', async () => {
      const { promise: gate, resolve } = promiseWithResolvers<void>()

      const slowRouter = {
        ping: os.handler(async () => {
          await gate
          return 'pong'
        }),
      }

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 100 },
      }), slowRouter)

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      expect(response!.body).toBeInstanceOf(ReadableStream)

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()
      const frames: Uint8Array[] = []

      const readNext = async () => {
        const { done, value } = await reader.read()
        if (!done && value) {
          frames.push(value)
        }
        return done
      }

      // First keep-alive after interval with no real message yet.
      const firstKeepAlive = readNext()
      await vi.advanceTimersByTimeAsync(100)
      await firstKeepAlive

      expect(frames).toHaveLength(1)
      expect(frames[0]).toEqual(new Uint8Array([0, 0, 0, 0]))

      // Another keep-alive while still idle.
      const secondKeepAlive = readNext()
      await vi.advanceTimersByTimeAsync(100)
      await secondKeepAlive

      expect(frames).toHaveLength(2)
      expect(frames[1]).toEqual(new Uint8Array([0, 0, 0, 0]))

      resolve()
      while (!(await readNext())) {
        // keep reading until closed
      }

      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not schedule a keep-alive timer when disabled', async () => {
      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: false },
      }))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      expect(response!.body).toBeInstanceOf(ReadableStream)
      expect(vi.getTimerCount()).toBe(0)

      // Drain so the stream can complete cleanly.
      await response!.arrayBuffer()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops keep-alive after the stream is cancelled', async () => {
      const gate = new Promise<void>(() => {})

      const slowRouter = {
        ping: os.handler(async () => {
          await gate
          return 'pong'
        }),
      }

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 50 },
      }), slowRouter)

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      expect(vi.getTimerCount()).toBeGreaterThan(0)

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()

      const first = reader.read()
      await vi.advanceTimersByTimeAsync(50)
      await first

      await reader.cancel()

      expect(vi.getTimerCount()).toBe(0)
    })

    it('clears keep-alive timer when keep-alive enqueue fails', async ({ onTestFinished }) => {
      const gate = new Promise<void>(() => {})

      const slowRouter = {
        ping: os.handler(async () => {
          await gate
          return 'pong'
        }),
      }

      const originalEnqueue = ReadableStreamDefaultController.prototype.enqueue
      const enqueueSpy = vi.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
        .mockImplementation(function (this: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) {
          // Keep-alive frame is a zero-length length prefix: [0, 0, 0, 0]
          if (
            chunk instanceof Uint8Array
            && chunk.byteLength === 4
            && chunk[0] === 0
            && chunk[1] === 0
            && chunk[2] === 0
            && chunk[3] === 0
          ) {
            throw new Error('keep-alive enqueue failed')
          }

          return originalEnqueue.call(this, chunk)
        })

      onTestFinished(() => {
        enqueueSpy.mockRestore()
      })

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 50 },
      }), slowRouter)

      await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      // One keep-alive setInterval is scheduled while the stream is idle.
      expect(vi.getTimerCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(50)

      // catch path should clear the interval after enqueue throws
      expect(vi.getTimerCount()).toBe(0)
    })

    it('clears keep-alive timer when peer-message enqueue throws', async ({ onTestFinished }) => {
      const enqueueSpy = vi.spyOn(ReadableStreamDefaultController.prototype, 'enqueue')
        .mockThrow(new Error('enqueue failed'))

      onTestFinished(() => {
        enqueueSpy.mockRestore()
      })

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: false },
      }))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()
      await expect(reader.read()).rejects.toThrow('enqueue failed')
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
