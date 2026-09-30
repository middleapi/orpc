import type { AnyRouter } from '../router'
import { ORPCError } from '@orpc/client'
import { promiseWithResolvers } from '@orpc/shared'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'
import { RequestCompressionHandlerPlugin } from './request-compression'
import { RequestLimitHandlerPlugin } from './request-limit'
import { RethrowHandlerPlugin } from './rethrow'

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

function decodeFrames(buffer: Uint8Array) {
  const messages: any[] = []

  for (let offset = 0; offset < buffer.byteLength;) {
    const length = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false)
    const payload = new TextDecoder().decode(buffer.subarray(offset + 4, offset + 4 + length))
    messages.push(JSON.parse(payload.split('\xFF')[0]!))
    offset += 4 + length
  }

  return messages
}

function waitForMacrotasks(ms = 20) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createEndlessStream() {
  const state = { pulls: 0, cancelled: false }
  const chunk = new Uint8Array(64 * 1024)

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++
      controller.enqueue(chunk)
    },
    cancel() {
      state.cancelled = true
    },
  })

  return { state, stream }
}

function createEndlessIterator() {
  const state = { yields: 0, finished: false }

  async function* iterator() {
    try {
      while (true) {
        state.yields++
        yield 'x'.repeat(1024)
      }
    }
    finally {
      state.finished = true
    }
  }

  return { state, iterator }
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

    it('cancels streamed sub-responses that exceed maxBufferedStreamSize', async () => {
      const endless = createEndlessIterator()
      const handler = createHandler(new BatchHandlerPlugin({ maxBufferedStreamSize: 10 * 1024 }), {
        ping: os.handler(() => 'pong'),
        subscribe: os.handler(endless.iterator),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/subscribe'), makePeerRequestMessage(1, '/ping')],
      }))

      expect(response!.status).toBe(207)
      expect(endless.state.finished).toBe(true)
      expect(endless.state.yields).toBeLessThanOrEqual(11)

      const body = await response!.json() as any[]
      const events = body.filter(message => message.id === 0 && message.kind === 'event-stream')
      expect(events.length).toBeGreaterThan(0)
      expect(events.length).toBeLessThanOrEqual(10)
      expect(body.at(-1)).toEqual({ id: 0, kind: 'cancel' })
      expect(body).toContainEqual(expect.objectContaining({ id: 1, kind: 'response', json: expect.objectContaining({ body: { json: 'pong' } }) }))
    })

    it('limits streamed sub-responses to 10MB by default', async () => {
      const endless = createEndlessStream()
      const handler = createHandler(new BatchHandlerPlugin(), {
        download: os.handler(() => endless.stream),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/download')],
      }))

      expect(response!.status).toBe(207)
      expect(endless.state.cancelled).toBe(true)
      // 10MB of 64KB chunks, plus the chunks the stream queued ahead
      expect(endless.state.pulls).toBeGreaterThanOrEqual(160)
      expect(endless.state.pulls).toBeLessThanOrEqual(165)
    })

    it('resolves maxBufferedStreamSize per batch request', async () => {
      const maxBufferedStreamSize = vi.fn(() => 0)
      const handler = createHandler(new BatchHandlerPlugin({ maxBufferedStreamSize }), {
        subscribe: os.handler(async function* () {
          yield 'too large'
        }),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/subscribe')],
      }))

      expect(maxBufferedStreamSize).toHaveBeenCalledTimes(1)
      expect(maxBufferedStreamSize).toHaveBeenCalledWith(expect.objectContaining({ request: expect.any(Object) }))

      const body = await response!.json() as any[]
      expect(body.map(message => message.kind)).toEqual(['response', 'cancel'])
    })

    it('does not limit streamed sub-responses in streaming mode', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ maxBufferedStreamSize: 0 }), {
        subscribe: os.handler(async function* () {
          yield 'a'
          yield 'b'
        }),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/subscribe')],
      }))

      const messages = decodeFrames(new Uint8Array(await response!.arrayBuffer()))
      expect(messages.map(message => message.kind)).toEqual(['response', 'event-stream', 'event-stream', 'event-stream'])
    })
  })

  describe('sub-request errors', () => {
    const router = {
      fail: os.handler(() => {
        throw new Error('db down')
      }),
      ping: os.handler(() => 'pong'),
    }

    const messages = [makePeerRequestMessage(0, '/fail'), makePeerRequestMessage(1, '/ping')]

    async function readSubResponses(mode: 'buffered' | 'streaming', response: Response) {
      const body = mode === 'buffered'
        ? await response.json() as any[]
        : decodeFrames(new Uint8Array(await response.arrayBuffer()))

      return body.sort((a, b) => a.id - b.id)
    }

    function captureUnhandledRejections(onTestFinished: (fn: () => void) => void) {
      const listener = vi.fn()
      process.on('unhandledRejection', listener)
      onTestFinished(() => {
        process.off('unhandledRejection', listener)
      })
      return listener
    }

    it.for(['buffered', 'streaming'] as const)('reports errors the rethrow plugin rethrows to onError in %s mode', async (mode, { onTestFinished }) => {
      const unhandledRejection = captureUnhandledRejections(onTestFinished)
      const onError = vi.fn()

      const handler = new RPCHandler(router, {
        plugins: [
          new BatchHandlerPlugin({ onError }),
          new RethrowHandlerPlugin({ filter: error => !(error instanceof ORPCError) }),
        ],
      })

      const { response } = await handler.handle(createBatchRequest({ mode, messages }))

      expect(response!.status).toBe(207)

      const [failed, succeeded] = await readSubResponses(mode, response!)
      expect(failed).toMatchObject({ id: 0, kind: 'response', json: { status: 500, body: 'Internal server error' } })
      expect(succeeded).toMatchObject({ id: 1, kind: 'response', json: { body: { json: 'pong' } } })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        new Error('db down'),
        expect.objectContaining({ url: '/fail' }),
        expect.objectContaining({ request: expect.objectContaining({ method: 'POST' }) }),
      )

      await waitForMacrotasks()
      expect(unhandledRejection).not.toHaveBeenCalled()
    })

    it.for(['buffered', 'streaming'] as const)('does not leave an unhandled rejection without onError in %s mode', async (mode, { onTestFinished }) => {
      const unhandledRejection = captureUnhandledRejections(onTestFinished)

      const handler = new RPCHandler(router, {
        plugins: [
          new BatchHandlerPlugin(),
          new RethrowHandlerPlugin({ filter: error => !(error instanceof ORPCError) }),
        ],
      })

      const { response } = await handler.handle(createBatchRequest({ mode, messages }))
      const [failed] = await readSubResponses(mode, response!)
      expect(failed).toMatchObject({ id: 0, json: { status: 500 } })

      await waitForMacrotasks()
      expect(unhandledRejection).not.toHaveBeenCalled()
    })

    it('returns 500 sub-response and reports the error when mapSubrequest throws', async () => {
      const onError = vi.fn()
      const handler = createHandler(new BatchHandlerPlugin({
        mapSubrequest: () => {
          throw new Error('boom')
        },
        onError,
      }))

      const { response } = await handler.handle(createBatchRequest({
        mode: 'buffered',
        messages: [makePeerRequestMessage(0, '/ping')],
      }))

      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(body[0].json.status).toBe(500)
      expect(body[0].json.body).toBe('Internal server error')
      expect(onError).toHaveBeenCalledWith(new Error('boom'), expect.objectContaining({ url: '/ping' }), expect.any(Object))
      expect(handlerFn).not.toHaveBeenCalled()
    })

    it.for([
      ['sync', () => {
        throw new Error('onError failed')
      }],
      ['async', async () => {
        throw new Error('onError failed')
      }],
    ] as const)('ignores errors thrown by a %s onError', async ([, onError], { onTestFinished }) => {
      const unhandledRejection = captureUnhandledRejections(onTestFinished)

      const handler = new RPCHandler(router, {
        plugins: [
          new BatchHandlerPlugin({ onError }),
          new RethrowHandlerPlugin({ filter: error => !(error instanceof ORPCError) }),
        ],
      })

      const { response } = await handler.handle(createBatchRequest({ mode: 'buffered', messages }))
      const [failed, succeeded] = await readSubResponses('buffered', response!)
      expect(failed).toMatchObject({ id: 0, json: { status: 500 } })
      expect(succeeded).toMatchObject({ id: 1, json: { body: { json: 'pong' } } })

      await waitForMacrotasks()
      expect(unhandledRejection).not.toHaveBeenCalled()
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

  describe('streaming backpressure', () => {
    it('only pulls a stream sub-response as fast as the batch response is read', async () => {
      const endless = createEndlessStream()
      const handler = createHandler(new BatchHandlerPlugin(), {
        download: os.handler(() => endless.stream),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/download')],
      }))

      await waitForMacrotasks()
      const unreadPulls = endless.state.pulls
      expect(unreadPulls).toBeLessThanOrEqual(5)

      await waitForMacrotasks()
      expect(endless.state.pulls).toBe(unreadPulls)

      const reader = response!.body!.getReader()
      for (let i = 0; i < 10; i++) {
        await reader.read()
      }

      await waitForMacrotasks()
      expect(endless.state.pulls).toBeGreaterThan(unreadPulls)
      expect(endless.state.pulls).toBeLessThanOrEqual(unreadPulls + 6)

      await reader.cancel()
      expect(endless.state.cancelled).toBe(true)
    })

    it('only pulls an event iterator sub-response as fast as the batch response is read', async () => {
      const endless = createEndlessIterator()
      const handler = createHandler(new BatchHandlerPlugin(), {
        subscribe: os.handler(endless.iterator),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/subscribe')],
      }))

      await waitForMacrotasks()
      const unreadYields = endless.state.yields
      expect(unreadYields).toBeLessThanOrEqual(3)

      await waitForMacrotasks()
      expect(endless.state.yields).toBe(unreadYields)

      await response!.body!.cancel()
      expect(endless.state.finished).toBe(true)
    })

    it('bounds the buffer across concurrent stream sub-responses', async () => {
      const streams = [createEndlessStream(), createEndlessStream(), createEndlessStream()]
      const handler = createHandler(new BatchHandlerPlugin(), {
        a: os.handler(() => streams[0]!.stream),
        b: os.handler(() => streams[1]!.stream),
        c: os.handler(() => streams[2]!.stream),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/a'), makePeerRequestMessage(1, '/b'), makePeerRequestMessage(2, '/c')],
      }))

      await waitForMacrotasks()
      const totalPulls = streams.reduce((sum, { state }) => sum + state.pulls, 0)
      expect(totalPulls).toBeLessThanOrEqual(15)

      await response!.body!.cancel()
      expect(streams.every(({ state }) => state.cancelled)).toBe(true)
    })

    it('settles sub-requests waiting on an unread response when the batch request is aborted', async () => {
      const endless = createEndlessIterator()
      const handler = createHandler(new BatchHandlerPlugin(), {
        subscribe: os.handler(endless.iterator),
      })

      const controller = new AbortController()
      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/subscribe')],
        signal: controller.signal,
      }))

      await waitForMacrotasks()
      controller.abort()

      await vi.waitFor(() => expect(endless.state.finished).toBe(true))
      // the stream closes once every sub-request settled
      await expect(response!.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer)
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

    it('aborts streaming sub-requests when the response stream is cancelled', async () => {
      const { response } = await handler.handle(createBatchRequest({ mode: 'streaming', messages }))

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

    it('sends a keep-alive frame only after a full interval without messages', async () => {
      const { promise: gate, resolve } = promiseWithResolvers<void>()

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 100 },
      }), {
        wait: os.handler(async () => {
          await gate
          return 'done'
        }),
        hang: os.handler(() => new Promise(() => {})),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/wait'), makePeerRequestMessage(1, '/hang')],
      }))

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()

      // The `/wait` response is sent at t=60.
      await vi.advanceTimersByTimeAsync(60)
      resolve()
      const prefix = await reader.read()
      const message = await reader.read()
      expect(readLengthPrefixedChunk(prefix.value!).messageLength).toBe(message.value!.byteLength)

      let keepAlive: Uint8Array | undefined
      void reader.read().then(({ value }) => {
        keepAlive = value
      })

      // At t=100 the stream has only been idle for 40ms.
      await vi.advanceTimersByTimeAsync(40)
      expect(keepAlive).toBeUndefined()

      await vi.advanceTimersByTimeAsync(60)
      expect(keepAlive).toEqual(new Uint8Array([0, 0, 0, 0]))
      expect(vi.getTimerCount()).toBe(1)

      await reader.cancel()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not queue keep-alive frames behind unread data', async () => {
      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 100 },
      }), {
        ping: os.handler(() => 'pong'),
        hang: os.handler(() => new Promise(() => {})),
      })

      const { response } = await handler.handle(createBatchRequest({
        mode: 'streaming',
        messages: [makePeerRequestMessage(0, '/ping'), makePeerRequestMessage(1, '/hang')],
      }))

      // The `/ping` response sits unread for ten intervals.
      await vi.advanceTimersByTimeAsync(1000)
      expect(vi.getTimerCount()).toBe(1)

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()
      const prefix = await reader.read()
      const message = await reader.read()
      expect(readLengthPrefixedChunk(prefix.value!).messageLength).toBe(message.value!.byteLength)

      let keepAlive: Uint8Array | undefined
      void reader.read().then(({ value }) => {
        keepAlive = value
      })

      // Nothing else was queued behind it, the next keep-alive only comes on the next tick.
      await vi.advanceTimersByTimeAsync(0)
      expect(keepAlive).toBeUndefined()

      await vi.advanceTimersByTimeAsync(100)
      expect(keepAlive).toEqual(new Uint8Array([0, 0, 0, 0]))

      await reader.cancel()
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

      // One keep-alive timer is scheduled while the stream is idle.
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
