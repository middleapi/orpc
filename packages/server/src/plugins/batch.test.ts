import type { AnyRouter } from '../router'
import { ORPCError } from '@orpc/client'
import { promiseWithResolvers } from '@orpc/shared'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'
import { RequestCompressionHandlerPlugin } from './request-compression'
import { RequestLimitHandlerPlugin } from './request-limit'

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
  method?: 'POST' | 'GET' | 'QUERY'
  data?: string
  signal?: AbortSignal
}) {
  if (options.method === 'GET') {
    const search = options.data === undefined ? '' : `?data=${options.data}`

    return new Request(`https://example.com/__batch__${search}`, {
      method: 'GET',
      headers: { 'orpc-batch': options.mode },
      signal: options.signal,
    })
  }

  return new Request('https://example.com/__batch__', {
    method: options.method ?? 'POST',
    headers: { 'orpc-batch': options.mode, 'content-type': 'application/json' },
    body: JSON.stringify(options.messages),
    signal: options.signal,
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

/**
 * Reads the length-prefixed batch stream one decoded message at a time, skipping keep-alive frames.
 * Resolves `undefined` once the stream ends.
 *
 * Decodes by hand because the numeric ids used here do not pass `decodePeerMessage` validation.
 */
function createMessageReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let buffer = new Uint8Array(0)

  return async (): Promise<any> => {
    while (true) {
      if (buffer.length >= 4) {
        const { messageLength, payload } = readLengthPrefixedChunk(buffer)

        if (buffer.length >= 4 + messageLength) {
          buffer = buffer.slice(4 + messageLength)

          if (messageLength === 0) {
            continue
          }

          const delimiterIndex = payload.indexOf(0xFF) // separates the json part from the binary one
          const jsonPart = delimiterIndex === -1 ? payload : payload.subarray(0, delimiterIndex)
          const message = JSON.parse(new TextDecoder().decode(jsonPart))

          if (delimiterIndex !== -1) {
            message.binary = payload.subarray(delimiterIndex + 1)
          }

          return message
        }
      }

      const { done, value } = await reader.read()

      if (done) {
        return undefined
      }

      const next = new Uint8Array(buffer.length + value.length)
      next.set(buffer)
      next.set(value, buffer.length)
      buffer = next
    }
  }
}

async function readAllMessages(read: () => Promise<any>) {
  const messages: any[] = []

  for (let message = await read(); message !== undefined; message = await read()) {
    messages.push(message)
  }

  return messages
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
      expect(response!.headers.get('content-type')).toEqual('application/vnd.orpc.batch')

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
      expect(await response!.text()).toContain('Invalid batch request body')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns the ORPCError message a body plugin throws while resolving the batch body', async () => {
      const handler = new RPCHandler(router, {
        plugins: [new BatchHandlerPlugin(), new RequestCompressionHandlerPlugin()],
      })

      const { response } = await handler.handle(new Request('https://example.com/__batch__', {
        method: 'POST',
        headers: {
          'orpc-batch': 'buffered',
          'content-type': 'application/json',
          'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip',
        },
        body: JSON.stringify([makePeerRequestMessage(0, '/ping')]),
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Too many content encodings.')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns the ORPCError message a body plugin raises while streaming the batch body', async () => {
      const handler = new RPCHandler(router, {
        plugins: [new BatchHandlerPlugin(), new RequestLimitHandlerPlugin({ maxBodySize: 10 })],
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain(new ORPCError('PAYLOAD_TOO_LARGE').message)
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

    describe('with a stream sub-response', () => {
      it.each([
        ['an event iterator', 'event-stream', (gate: Promise<void>) => (async function* () {
          yield 'first'
          await gate
        })()],
        ['a readable stream', 'octet-stream', (gate: Promise<void>) => new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('first'))
            await gate
            controller.close()
          },
        })],
      ] as const)('streams the batch once a sub-response is %s', async (_, kind, createStream) => {
        const gate = promiseWithResolvers<void>()
        const handler = createHandler(new BatchHandlerPlugin(), {
          ping: os.handler(() => 'pong'),
          stream: os.handler(() => createStream(gate.promise)),
        })

        // The stream stays open until the gate is released, so a buffered batch would never answer
        const { response } = await handler.handle(createBatchRequest({
          mode: 'buffered',
          messages: [makePeerRequestMessage(0, '/ping'), makePeerRequestMessage(1, '/stream')],
        }))

        expect(response!.status).toBe(207)
        expect(response!.headers.get('standard-server')).toEqual('octet-stream')
        expect(response!.headers.get('content-type')).toEqual('application/vnd.orpc.batch')

        const read = createMessageReader(response!.body!)
        const beforeGate = [await read(), await read(), await read()]

        expect(beforeGate).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 0, kind: 'response' }),
          expect.objectContaining({ id: 1, kind: 'response' }),
          expect.objectContaining({ id: 1, kind }),
        ]))

        gate.resolve()

        expect(await readAllMessages(read)).toEqual([
          expect.objectContaining({ id: 1, kind }),
        ])
      })

      it('writes the sub-responses buffered before it first, binary included', async () => {
        const gate = promiseWithResolvers<void>()
        const ping = vi.fn(() => 'pong')
        const file = vi.fn(() => new Blob(['__FILE__'], { type: 'application/octet-stream' }))

        const handler = createHandler(new BatchHandlerPlugin(), {
          ping: os.handler(ping),
          file: os.handler(file),
          events: os.handler(async () => {
            await gate.promise

            return (async function* () {
              yield 'event'
            })()
          }),
        })

        const result = handler.handle(createBatchRequest({
          mode: 'buffered',
          messages: [
            makePeerRequestMessage(0, '/ping'),
            makePeerRequestMessage(1, '/file'),
            makePeerRequestMessage(2, '/events'),
          ],
        }))

        await vi.waitFor(() => {
          expect(ping).toHaveBeenCalledTimes(1)
          expect(file).toHaveBeenCalledTimes(1)
        })
        await new Promise(resolve => setTimeout(resolve, 10)) // let both responses reach the buffer

        gate.resolve()
        const { response } = await result
        expect(response!.headers.get('standard-server')).toEqual('octet-stream')

        const messages = await readAllMessages(createMessageReader(response!.body!))

        expect(messages).toEqual([
          expect.objectContaining({ id: 0, kind: 'response' }),
          expect.objectContaining({ id: 1, kind: 'response' }),
          expect.objectContaining({ id: 2, kind: 'response' }),
          expect.objectContaining({ id: 2, kind: 'event-stream' }),
          expect.objectContaining({ id: 2, kind: 'event-stream', json: expect.objectContaining({ event: 'close' }) }),
        ])
        expect(new TextDecoder().decode(messages[1].binary)).toBe('__FILE__')
      })
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
      expect(response!.headers.get('content-type')).toEqual('application/vnd.orpc.batch')

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

  describe('batch request abort', () => {
    const started = vi.fn()
    const stopped = vi.fn()

    function waitForAbort(signal: AbortSignal) {
      return new Promise((resolve) => {
        if (signal.aborted) {
          resolve(undefined)
        }
        signal.addEventListener('abort', resolve)
      })
    }

    const handler = createHandler(new BatchHandlerPlugin(), {
      wait: os.handler(async ({ signal }) => {
        started()
        await waitForAbort(signal!)
        stopped(signal!.aborted)
      }),
      subscribe: os.handler(async function* ({ signal }) {
        started()
        try {
          yield 'ready'
          await waitForAbort(signal!)
        }
        finally {
          await new Promise(resolve => setTimeout(resolve)) // async cleanup
          stopped(signal!.aborted)
        }
      }),
    })

    const messages = [makePeerRequestMessage(0, '/wait'), makePeerRequestMessage(1, '/subscribe')]

    it.each(['buffered', 'streaming'] as const)('aborts %s sub-requests when the batch request is aborted', async (mode) => {
      const controller = new AbortController()
      const result = handler.handle(createBatchRequest({ mode, messages, signal: controller.signal }))

      await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
      expect(stopped).not.toHaveBeenCalled()

      controller.abort()

      await vi.waitFor(() => expect(stopped.mock.calls).toEqual([[true], [true]]))
      await expect(result).resolves.toMatchObject({ matched: true })
    })

    it('aborts buffered sub-requests without a stream sub-response when the batch request is aborted', async () => {
      const controller = new AbortController()
      const result = handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/wait'), makePeerRequestMessage(1, '/wait')],
        signal: controller.signal,
      }))

      await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
      expect(stopped).not.toHaveBeenCalled()

      controller.abort()

      await vi.waitFor(() => expect(stopped.mock.calls).toEqual([[true], [true]]))
      await expect(result).resolves.toMatchObject({ matched: true })
    })

    /**
     * In buffered mode, the stream sub-response makes the batch a stream too.
     */
    it.each(['buffered', 'streaming'] as const)('aborts %s sub-requests when the response stream is cancelled', async (mode) => {
      const { response } = await handler.handle(createBatchRequest({ mode, messages }))

      await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
      await response!.body!.cancel()

      expect(stopped.mock.calls).toEqual([[true], [true]])
    })

    it.each(['buffered', 'streaming'] as const)('aborts %s sub-requests when the batch request is already aborted', async (mode) => {
      const { response } = await handler.handle(createBatchRequest({
        mode,
        messages: [makePeerRequestMessage(0, '/wait')],
        signal: AbortSignal.abort(),
      }))
      await response!.arrayBuffer()

      expect(stopped.mock.calls).toEqual([[true]])
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

    it('returns 400 when a GET batch contains a non-GET sub-request', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify([
        makePeerRequestMessage(0, '/ping', 'GET'),
        makePeerRequestMessage(1, '/ping', 'POST'),
      ]))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'GET',
        data,
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('GET batch requests only accept GET sub-requests')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 400 when a GET batch sub-request omits the method (defaults to POST)', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify([
        { kind: 'request', id: 0, json: { url: '/ping', headers: {} } },
      ]))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'GET',
        data,
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('GET batch requests only accept GET sub-requests')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })
  })

  describe('query batches', () => {
    it('returns 400 before execution when a QUERY batch contains a non-request message', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'QUERY',
        messages: [
          { kind: 'response', id: 0, json: { method: 'POST', url: '/ping', headers: {} } },
        ],
      }))

      expect(response!.status).toBe(400)
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 400 before execution when a QUERY batch contains a non-QUERY sub-request', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        method: 'QUERY',
        messages: [
          makePeerRequestMessage(0, '/ping', 'QUERY'),
          makePeerRequestMessage(1, '/ping', 'POST'),
        ],
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('QUERY batch requests only accept QUERY sub-requests')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })
  })

  describe('sub-request headers', () => {
    function createHeaderCapturingHandler() {
      const seenHeaders: Record<string, string | string[] | undefined>[] = []

      const handler = new RPCHandler(router, {
        plugins: [new BatchHandlerPlugin()],
        interceptors: [({ next, request }) => {
          seenHeaders.push(request.headers)
          return next()
        }],
      })

      return { handler, seenHeaders }
    }

    function createBatchRequestWithHeaders(headers: Record<string, string>, subRequestHeaders: Record<string, string>) {
      return new Request('https://example.com/__batch__', {
        method: 'POST',
        headers: { 'orpc-batch': 'buffered', 'content-type': 'application/json', ...headers },
        body: JSON.stringify([
          { kind: 'request', id: 0, json: { method: 'POST', url: '/ping', headers: subRequestHeaders }, binary: undefined },
        ]),
      })
    }

    it('merges batch request headers into sub-requests and lets the batch request win', async () => {
      const { handler, seenHeaders } = createHeaderCapturingHandler()

      await handler.handle(createBatchRequestWithHeaders(
        { 'x-from-batch': 'batch', 'x-overridden': 'batch' },
        { 'x-from-sub-request': 'sub-request', 'x-overridden': 'sub-request' },
      ))

      expect(seenHeaders[0]).toMatchObject({
        'x-from-batch': 'batch',
        'x-from-sub-request': 'sub-request',
        'x-overridden': 'batch',
      })
      expect(seenHeaders[0]!['orpc-batch']).toBeUndefined()
    })

    it('prevents a sub-request from spoofing a header the batch request already carries', async () => {
      const { handler, seenHeaders } = createHeaderCapturingHandler()

      await handler.handle(createBatchRequestWithHeaders(
        { authorization: 'Bearer real' },
        { authorization: 'Bearer spoofed' },
      ))

      expect(seenHeaders[0]!.authorization).toEqual('Bearer real')
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

    it('sends keep-alive frames once a buffered batch starts streaming', async () => {
      const gate = promiseWithResolvers<void>()

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 100 },
      }), {
        events: os.handler(async function* () {
          await gate.promise
        }),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/events')],
      }))

      expect(response!.body).toBeInstanceOf(ReadableStream)

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()

      // The response message: its length prefix, then its payload
      await reader.read()
      await reader.read()

      const keepAlive = reader.read()
      await vi.advanceTimersByTimeAsync(100)
      await expect(keepAlive).resolves.toEqual({ done: false, value: new Uint8Array([0, 0, 0, 0]) })

      gate.resolve()
      while (!(await reader.read()).done) {
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
