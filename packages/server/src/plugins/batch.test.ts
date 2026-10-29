import type { StandardResponse } from '@standard-server/core'
import type { AnyRouter } from '../router'
import { getResponseHeaders, ORPCError } from '@orpc/client'
import { promiseWithResolvers, sleep } from '@orpc/shared'
import { decodePeerMessage } from '@standard-server/peer'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'
import { RequestCompressionHandlerPlugin } from './request-compression'
import { RequestLimitHandlerPlugin } from './request-limit'

beforeEach(() => {
  vi.clearAllMocks()
})

function makePeerRequestMessage(id: string, url: string, method = 'POST', body?: unknown) {
  return {
    kind: 'request',
    id,
    json: { method, url, headers: {}, body },
    binary: undefined,
  }
}

/**
 * An array nested deep enough that `JSON.stringify` overflows the stack on it, written as JSON by hand for that reason.
 */
const DEEPLY_NESTED_ARRAY_JSON = `${'['.repeat(10_000)}${']'.repeat(10_000)}`

const INVALID_MESSAGE_IDS = [
  ['true', true],
  ['an object', {}],
  ['an array', []],
  ['null', null],
  ['a number', 0],
  ['missing', undefined],
] as const

function createBatchRequest(options: {
  messages?: unknown
  method?: 'POST' | 'GET' | 'QUERY'
  data?: string
  signal?: AbortSignal
}) {
  if (options.method === 'GET') {
    const search = options.data === undefined ? '' : `?data=${options.data}`

    return new Request(`https://example.com/__batch__${search}`, {
      method: 'GET',
      headers: { 'orpc-batch': '1' },
      signal: options.signal,
    })
  }

  return new Request('https://example.com/__batch__', {
    method: options.method ?? 'POST',
    headers: { 'orpc-batch': '1', 'content-type': 'application/json' },
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
 * Decodes every message of a length-prefixed batch body, skipping keep-alive frames.
 * Needs string message ids, which `decodePeerMessage` requires.
 */
async function readAllMessages(response: Response) {
  let buffer = new Uint8Array(await response.arrayBuffer())
  const messages: any[] = []

  while (buffer.length > 0) {
    const { messageLength, payload } = readLengthPrefixedChunk(buffer)
    buffer = buffer.slice(4 + messageLength)

    if (messageLength > 0) {
      const result = decodePeerMessage(payload)
      expect(result.matched).toBe(true)
      messages.push(result.matched ? result.message : undefined)
    }
  }

  return messages
}

/**
 * Reads past one message, which is enqueued as two chunks: its length prefix, then its payload.
 */
async function skipMessage(reader: ReadableStreamDefaultReader<Uint8Array>) {
  await reader.read()
  await reader.read()
}

function waitForAbort(signal: AbortSignal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(undefined)
    }
    signal.addEventListener('abort', resolve)
  })
}

/**
 * A router with an `events` procedure that returns a stream of one event.
 */
const eventsRouter = {
  events: os.handler(async function* () {
    yield 'event'
  }),
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

  describe('responses', () => {
    it('handles batch POST requests', async () => {
      const handler = createHandler()
      const peerMessages = [
        makePeerRequestMessage('0', '/ping'),
        makePeerRequestMessage('1', '/ping'),
      ]

      const { matched, response } = await handler.handle(createBatchRequest({
        messages: peerMessages,
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)
      expect(handlerFn).toHaveBeenCalledTimes(2)
    })

    it('returns binary payload when sub-response contains binary', async () => {
      const binaryRouter = {
        file: os.handler(() => new Blob([new Uint8Array([1, 2, 3])], {
          type: 'application/octet-stream',
        })),
        ping: os.handler(() => 'pong'),
      }

      const handler = createHandler(new BatchHandlerPlugin(), binaryRouter)

      const peerMessages = [
        makePeerRequestMessage('0', '/file'),
        makePeerRequestMessage('1', '/ping'),
      ]

      const { response } = await handler.handle(createBatchRequest({
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
        messages: [makePeerRequestMessage('0', '/nonexistent')],
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ kind: 'response', id: '0' })
      expect(body[0].json.status).toBe(404)
    })

    it('returns 400 for invalid batch body', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        messages: 'not-an-array',
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Invalid batch request body')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it.each(INVALID_MESSAGE_IDS)('returns 400 for a batch body whose message id is %s', async (_, id) => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        messages: [{ ...makePeerRequestMessage('0', '/ping'), id }],
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Invalid batch request body')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 400 for a batch body whose message id is a deeply nested array', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(new Request('https://example.com/__batch__', {
        method: 'POST',
        headers: { 'orpc-batch': '1', 'content-type': 'application/json' },
        body: `[{"id":${DEEPLY_NESTED_ARRAY_JSON},"kind":"request","json":{"url":"/ping"}}]`,
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
          'orpc-batch': '1',
          'content-type': 'application/json',
          'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip',
        },
        body: JSON.stringify([makePeerRequestMessage('0', '/ping')]),
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
        messages: [makePeerRequestMessage('0', '/ping')],
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain(new ORPCError('PAYLOAD_TOO_LARGE').message)
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 413 when batch size exceeds maxSize', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ maxSize: 1 }))
      const peerMessages = [
        makePeerRequestMessage('0', '/ping'),
        makePeerRequestMessage('1', '/ping'),
      ]

      const { response } = await handler.handle(createBatchRequest({
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
        messages: [makePeerRequestMessage('0', '/ping')],
      }))

      expect(response!.status).toBe(207)

      const body = await response!.json() as any
      expect(body[0].json.status).toBe(500)
      expect(body[0].json.body).toBe('Internal server error')
      expect(rejectSpy).toHaveBeenCalledTimes(1)
    })

    it('returns 500 sub-response when mapSubresponse throws', async ({ onTestFinished }) => {
      const rejectSpy = vi.spyOn(Promise, 'reject')
        .mockImplementation(() => new Promise(() => {}) as Promise<never>)

      onTestFinished(() => {
        rejectSpy.mockRestore()
      })

      const handler = createHandler(new BatchHandlerPlugin({
        mapSubresponse: () => {
          throw new Error('boom')
        },
      }))

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/ping')],
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

        // The stream stays open until the gate is released, so the batch must stream to answer
        const { response } = await handler.handle(createBatchRequest({
          messages: [makePeerRequestMessage('0', '/ping'), makePeerRequestMessage('1', '/stream')],
        }))

        expect(response!.status).toBe(207)
        expect(response!.headers.get('standard-server')).toEqual('octet-stream')
        expect(response!.headers.get('content-type')).toEqual('application/vnd.orpc.batch')

        gate.resolve()
        const messages = await readAllMessages(response!)

        expect(messages.filter(m => m.id === '0')).toEqual([
          expect.objectContaining({ kind: 'response' }),
        ])
        expect(messages.filter(m => m.id === '1')).toEqual([
          expect.objectContaining({ kind: 'response' }),
          expect.objectContaining({ kind }),
          expect.objectContaining({ kind }),
        ])
      })

      it('waits for every sub-response before it streams', async () => {
        const gate = promiseWithResolvers<void>()
        const handler = createHandler(new BatchHandlerPlugin(), {
          ...eventsRouter,
          file: os.handler(async () => {
            await gate.promise
            return new Blob(['__FILE__'], { type: 'application/octet-stream' })
          }),
        })

        let settled = false
        const result = handler.handle(createBatchRequest({
          messages: [makePeerRequestMessage('0', '/events'), makePeerRequestMessage('1', '/file')],
        })).finally(() => {
          settled = true
        })

        await sleep(10)
        expect(settled).toBe(false)

        gate.resolve()
        const { response } = await result
        expect(response!.headers.get('content-type')).toEqual('application/vnd.orpc.batch')

        const messages = await readAllMessages(response!)
        expect(messages.filter(m => m.kind === 'response').map(m => m.id).sort()).toEqual(['0', '1'])
        expect(new TextDecoder().decode(messages.find(m => m.id === '1').binary)).toBe('__FILE__')
      })
    })
  })

  describe('batch request abort', () => {
    const started = vi.fn()
    const stopped = vi.fn()

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

    const messages = [makePeerRequestMessage('0', '/wait'), makePeerRequestMessage('1', '/subscribe')]

    it.each([
      // The stream sub-response waits for `wait`, so its generator never starts
      ['with', messages, 1],
      ['without', [makePeerRequestMessage('0', '/wait'), makePeerRequestMessage('1', '/wait')], 2],
    ] as const)('aborts sub-requests %s a stream sub-response when the batch request is aborted', async (_, batchMessages, running) => {
      const controller = new AbortController()
      const result = handler.handle(createBatchRequest({ messages: batchMessages, signal: controller.signal }))

      await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(running))
      expect(stopped).not.toHaveBeenCalled()

      controller.abort()

      await vi.waitFor(() => expect(stopped.mock.calls).toEqual(Array.from({ length: running }, () => [true])))
      await expect(result).resolves.toMatchObject({ matched: true })
      expect(started).toHaveBeenCalledTimes(running)
    })

    it('aborts sub-requests when the response stream is cancelled', async () => {
      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/subscribe'), makePeerRequestMessage('1', '/subscribe')],
      }))

      await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
      await response!.body!.cancel()

      expect(stopped.mock.calls).toEqual([[true], [true]])
    })

    it('aborts sub-requests when the batch request is already aborted', async () => {
      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/wait')],
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
        makePeerRequestMessage('0', '/ping', 'GET'),
      ]))

      const { matched, response } = await handler.handle(createBatchRequest({
        method: 'GET',
        data,
      }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(207)
    })

    it('returns 400 for invalid GET data param', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        method: 'GET',
        data: 'invalid-json',
      }))

      expect(response!.status).toBe(400)
    })

    it('returns 400 when GET batch request misses data param', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        method: 'GET',
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Missing data parameter')
    })

    it('returns 400 for GET batch data that is valid JSON but not an array', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify({ not: 'an-array' }))

      const { response } = await handler.handle(createBatchRequest({
        method: 'GET',
        data,
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Invalid batch request data parameter')
    })

    it.each(INVALID_MESSAGE_IDS)('returns 400 for GET batch data whose message id is %s', async (_, id) => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify([
        { ...makePeerRequestMessage('0', '/ping', 'GET'), id },
      ]))

      const { response } = await handler.handle(createBatchRequest({
        method: 'GET',
        data,
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Invalid batch request data parameter')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 400 for GET batch data whose message id is a deeply nested array', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(`[{"id":${DEEPLY_NESTED_ARRAY_JSON},"kind":"request","json":{"method":"GET","url":"/ping"}}]`)

      const { response } = await handler.handle(createBatchRequest({
        method: 'GET',
        data,
      }))

      expect(response!.status).toBe(400)
      expect(await response!.text()).toContain('Invalid batch request data parameter')
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 400 when a GET batch contains a non-GET sub-request', async () => {
      const handler = createHandler()
      const data = encodeURIComponent(JSON.stringify([
        makePeerRequestMessage('0', '/ping', 'GET'),
        makePeerRequestMessage('1', '/ping', 'POST'),
      ]))

      const { response } = await handler.handle(createBatchRequest({
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
        { kind: 'request', id: '0', json: { url: '/ping', headers: {} } },
      ]))

      const { response } = await handler.handle(createBatchRequest({
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
        method: 'QUERY',
        messages: [
          { kind: 'response', id: '0', json: { method: 'POST', url: '/ping', headers: {} } },
        ],
      }))

      expect(response!.status).toBe(400)
      expect(handlerFn).toHaveBeenCalledTimes(0)
    })

    it('returns 400 before execution when a QUERY batch contains a non-QUERY sub-request', async () => {
      const handler = createHandler()

      const { response } = await handler.handle(createBatchRequest({
        method: 'QUERY',
        messages: [
          makePeerRequestMessage('0', '/ping', 'QUERY'),
          makePeerRequestMessage('1', '/ping', 'POST'),
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
        headers: { 'orpc-batch': '1', 'content-type': 'application/json', ...headers },
        body: JSON.stringify([
          { kind: 'request', id: '0', json: { method: 'POST', url: '/ping', headers: subRequestHeaders }, binary: undefined },
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

  describe('response headers', () => {
    const base = os

    const headersRouter = {
      ping: base.handler(() => 'pong'),
      login: base.handler(({ context }) => {
        getResponseHeaders(context)?.append('set-cookie', 'session=abc; HttpOnly')
        getResponseHeaders(context)?.append('set-cookie', 'theme=dark')
        getResponseHeaders(context)?.set('cache-control', 'max-age=60')
        getResponseHeaders(context)?.set('content-language', 'en')
        getResponseHeaders(context)?.set('x-only', 'login')
        return 'ok'
      }),
      refresh: base.handler(({ context }) => {
        getResponseHeaders(context)?.append('set-cookie', 'token=xyz; HttpOnly')
        getResponseHeaders(context)?.set('cache-control', 'max-age=60')
        getResponseHeaders(context)?.set('content-language', 'en')
        return 'ok'
      }),
      uncached: base.handler(({ context }) => {
        getResponseHeaders(context)?.set('cache-control', 'no-store')
        return 'ok'
      }),
      image: base.handler(({ context }) => {
        getResponseHeaders(context)?.append('set-cookie', 'download=1')
        getResponseHeaders(context)?.set('cache-control', 'max-age=60')
        return new Blob(['__TEST__'], { type: 'image/png' })
      }),
      events: base.handler(({ context }) => {
        getResponseHeaders(context)?.set('cache-control', 'max-age=60')
        return (async function* () {
          yield 'event'
        })()
      }),
    }

    it('moves cookies and shared headers onto the batch response', async () => {
      const { response } = await createHandler(undefined, headersRouter).handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', '/refresh')],
      }))

      expect(response!.status).toBe(207)
      expect(response!.headers.getSetCookie()).toEqual(['session=abc; HttpOnly', 'theme=dark', 'token=xyz; HttpOnly'])
      expect(response!.headers.get('cache-control')).toBe('max-age=60')
      // describes each sub-response's body, not the batch response's
      expect(response!.headers.get('content-language')).toBe(null)

      const body = await response!.json() as any[]
      expect(body.find(m => m.id === '0').json.headers).toEqual({ 'content-language': 'en', 'x-only': 'login' })
      expect(body.find(m => m.id === '1').json.headers).toEqual({ 'content-language': 'en' })
    })

    it.each([
      ['has another value', '/uncached'],
      ['lacks it', '/ping'],
    ])('keeps a header on the sub-responses when one of them %s', async (_, url) => {
      const { response } = await createHandler(undefined, headersRouter).handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', url)],
      }))

      expect(response!.headers.getSetCookie()).toEqual(['session=abc; HttpOnly', 'theme=dark'])
      expect(response!.headers.get('cache-control')).toBe(null)

      const body = await response!.json() as any[]
      expect(body.find(m => m.id === '0').json.headers['cache-control']).toBe('max-age=60')
    })

    it('merges cookies with, and keeps shared headers off, the ones the headers option sets', async () => {
      const handler = createHandler(new BatchHandlerPlugin({
        headers: { 'set-cookie': 'batch=1', 'cache-control': 'no-cache' },
      }), headersRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', '/refresh')],
      }))

      expect(response!.headers.getSetCookie()).toEqual(['batch=1', 'session=abc; HttpOnly', 'theme=dark', 'token=xyz; HttpOnly'])
      expect(response!.headers.get('cache-control')).toBe('no-cache')

      const body = await response!.json() as any[]
      expect(body.map(m => m.json.headers['cache-control'])).toEqual(['max-age=60', 'max-age=60'])
    })

    it('drops a sub-response header the batch response already has with the same value', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ headers: { 'x-only': 'login' } }), headersRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', '/refresh')],
      }))

      expect(response!.headers.get('x-only')).toBe('login')

      const body = await response!.json() as any[]
      expect(body.find(m => m.id === '0').json.headers).toEqual({ 'content-language': 'en' })
    })

    it('lets mapSubresponse keep headers on each sub-response, cookies included', async () => {
      const mapSubresponse = vi.fn((subresponse: StandardResponse) => subresponse)
      const handler = createHandler(new BatchHandlerPlugin({ mapSubresponse }), headersRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', '/refresh')],
      }))

      // The batch response still carries them
      expect(response!.headers.getSetCookie()).toEqual(['session=abc; HttpOnly', 'theme=dark', 'token=xyz; HttpOnly'])
      expect(response!.headers.get('cache-control')).toBe('max-age=60')

      const body = await response!.json() as any[]
      expect(body.find(m => m.id === '1').json.headers).toEqual({
        'set-cookie': 'token=xyz; HttpOnly',
        'cache-control': 'max-age=60',
        'content-language': 'en',
      })

      expect(mapSubresponse).toHaveBeenCalledTimes(2)
      expect(mapSubresponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 200 }),
        { status: 207, headers: expect.objectContaining({ 'cache-control': 'max-age=60' }) },
        expect.objectContaining({ request: expect.objectContaining({ url: '/__batch__' }) }),
      )
    })

    it('keeps a shared header off the batch response when the headers option sets it to undefined', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ headers: { 'cache-control': undefined } }), headersRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', '/refresh')],
      }))

      expect(response!.headers.get('cache-control')).toBe(null)

      const body = await response!.json() as any[]
      expect(body.map(m => m.json.headers['cache-control'])).toEqual(['max-age=60', 'max-age=60'])
    })

    it('merges every sub-response\'s vary fields onto the batch response', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ headers: { vary: 'Origin' } }), {
        localized: os.handler(({ context }) => {
          getResponseHeaders(context)?.set('cache-control', 'public, max-age=60')
          getResponseHeaders(context)?.set('vary', 'Accept-Language, origin')
          return 'ok'
        }),
        personal: os.handler(({ context }) => {
          getResponseHeaders(context)?.set('cache-control', 'public, max-age=60')
          getResponseHeaders(context)?.set('vary', 'Cookie')
          return 'ok'
        }),
        shared: os.handler(({ context }) => {
          getResponseHeaders(context)?.set('cache-control', 'public, max-age=60')
          return 'ok'
        }),
      })

      const { response } = await handler.handle(createBatchRequest({
        messages: [
          makePeerRequestMessage('0', '/localized'),
          makePeerRequestMessage('1', '/personal'),
          makePeerRequestMessage('2', '/shared'),
        ],
      }))

      expect(response!.headers.get('cache-control')).toBe('public, max-age=60')
      expect(response!.headers.get('vary')).toBe('Origin, Accept-Language, Cookie')
    })

    it('varies the batch response on everything when a sub-response varies on everything', async () => {
      const handler = createHandler(new BatchHandlerPlugin(), {
        any: os.handler(({ context }) => {
          getResponseHeaders(context)?.set('vary', '*')
          return 'ok'
        }),
        localized: os.handler(({ context }) => {
          getResponseHeaders(context)?.set('vary', 'Accept-Language')
          return 'ok'
        }),
      })

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/any'), makePeerRequestMessage('1', '/localized')],
      }))

      expect(response!.headers.get('vary')).toBe('*')
    })

    it('sets each distinct cookie once, including the ones the headers option sets', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ headers: { 'set-cookie': 'theme=dark' } }), headersRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/login'), makePeerRequestMessage('1', '/login')],
      }))

      expect(response!.headers.getSetCookie()).toEqual(['theme=dark', 'session=abc; HttpOnly'])
    })

    it('moves cookies and shared headers onto a batch response that carries binary', async () => {
      const { response } = await createHandler(undefined, headersRouter).handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/image'), makePeerRequestMessage('1', '/refresh')],
      }))

      expect(response!.headers.get('content-type')).toBe('application/vnd.orpc.batch')
      expect(response!.headers.getSetCookie()).toEqual(['download=1', 'token=xyz; HttpOnly'])
      expect(response!.headers.get('cache-control')).toBe('max-age=60')

      const received = await readAllMessages(response!)
      const image = received.find(m => m.id === '0')
      expect(JSON.stringify(received)).not.toContain('set-cookie')
      expect(image.json.headers['cache-control']).toBe(undefined)
      expect(image.json.headers['content-type']).toBe('image/png')
      expect(new TextDecoder().decode(image.binary)).toBe('__TEST__')
    })

    it.each([
      ['json', ['/ping', '/refresh'], 'json'],
      ['binary', ['/image', '/refresh'], 'file'],
      ['streaming', ['/events', '/refresh'], 'octet-stream'],
    ])('keeps the content type the headers option sets on a %s batch response', async (_case, urls, hint) => {
      const handler = createHandler(new BatchHandlerPlugin({ headers: { 'content-type': 'application/x-custom' } }), headersRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: urls.map((url, index) => makePeerRequestMessage(String(index), url)),
      }))

      expect(response!.headers.get('content-type')).toBe('application/x-custom')
      expect(response!.headers.get('standard-server')).toBe(hint)
    })

    it('moves cookies and shared headers onto a batch response that streams', async () => {
      const { response } = await createHandler(undefined, headersRouter).handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/events'), makePeerRequestMessage('1', '/login')],
      }))

      expect(response!.headers.get('content-type')).toBe('application/vnd.orpc.batch')
      expect(response!.headers.getSetCookie()).toEqual(['session=abc; HttpOnly', 'theme=dark'])
      expect(response!.headers.get('cache-control')).toBe('max-age=60')

      const received = await readAllMessages(response!)
      expect(JSON.stringify(received)).not.toContain('set-cookie')
      expect(received.filter(m => m.kind === 'response').map(m => m.json.headers?.['cache-control'])).toEqual([undefined, undefined])
    })
  })

  describe('configuration options', () => {
    it('supports custom successStatus', async () => {
      const handler = createHandler(new BatchHandlerPlugin({ successStatus: 200 }))
      const peerMessages = [makePeerRequestMessage('0', '/ping')]

      const { response } = await handler.handle(createBatchRequest({
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

    /**
     * A stream sub-response that stays idle until the batch is cancelled.
     */
    const idleRouter = {
      idle: os.handler(async function* ({ signal }) {
        await waitForAbort(signal!)
      }),
    }

    it('sends zero-length keep-alive frames while the batch stream is idle', async () => {
      const gate = promiseWithResolvers<void>()

      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 100 },
      }), {
        events: os.handler(async function* () {
          await gate.promise
        }),
      })

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/events')],
      }))

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()

      await skipMessage(reader) // the response message

      for (let i = 0; i < 2; i++) {
        const keepAlive = reader.read()
        await vi.advanceTimersByTimeAsync(100)
        await expect(keepAlive).resolves.toEqual({ done: false, value: new Uint8Array([0, 0, 0, 0]) })
      }

      gate.resolve()
      while (!(await reader.read()).done) {
        // keep reading until closed
      }

      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not schedule a keep-alive timer when disabled', async () => {
      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: false },
      }), eventsRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/events')],
      }))

      expect(response!.body).toBeInstanceOf(ReadableStream)
      expect(vi.getTimerCount()).toBe(0)

      // Drain so the stream can complete cleanly.
      await response!.arrayBuffer()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops keep-alive after the stream is cancelled', async () => {
      const handler = createHandler(new BatchHandlerPlugin({
        keepAlive: { enabled: true, interval: 50 },
      }), idleRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/idle')],
      }))

      expect(vi.getTimerCount()).toBeGreaterThan(0)

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()
      await skipMessage(reader) // the response message

      const first = reader.read()
      await vi.advanceTimersByTimeAsync(50)
      await first

      await reader.cancel()

      expect(vi.getTimerCount()).toBe(0)
    })

    it('clears keep-alive timer when keep-alive enqueue fails', async ({ onTestFinished }) => {
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
      }), idleRouter)

      await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/idle')],
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
      }), eventsRouter)

      const { response } = await handler.handle(createBatchRequest({
        messages: [makePeerRequestMessage('0', '/events')],
      }))

      const reader = (response!.body as ReadableStream<Uint8Array>).getReader()
      await expect(reader.read()).rejects.toThrow('enqueue failed')
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
