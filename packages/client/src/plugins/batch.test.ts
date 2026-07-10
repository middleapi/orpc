import type { StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import { sleep } from '@orpc/shared'
import { encodePeerMessage } from '@standardserver/peer'
import { StandardLink } from '../adapters/standard'
import { BatchLinkPlugin } from './batch'

interface TestContext {
  tag?: string
}

function makeCodec(): StandardLinkCodec<TestContext> {
  return {
    encodeInput: vi.fn(async (input, path, { signal }) => {
      return {
        method: 'POST',
        url: `/${path.join('/')}` as `/${string}`,
        headers: { 'content-type': 'application/json' },
        body: input,
        signal,
      } satisfies StandardRequest
    }),
    decodeResponse: vi.fn(async (response) => {
      const body = await response.resolveBody()
      return { kind: 'output' as const, output: body }
    }),
  }
}

function extractBatchMessagesFromRequest(request: StandardRequest): any[] {
  if (Array.isArray(request.body)) {
    return request.body
  }

  // GET batch requests encode the message list in the `data` query param.
  const match = request.url.match(/[?&]data=([^&#]*)/)
  return match ? JSON.parse(decodeURIComponent(match[1]!)) : []
}

function makeBufferedBatchResponseFromRequest(request: StandardRequest, resultFn?: (id: unknown, index: number) => unknown): StandardLazyResponse {
  const messages = extractBatchMessagesFromRequest(request)

  return {
    status: 207,
    headers: {},
    resolveBody: async () => messages.map((msg: any, i: number) => ({
      kind: 'response',
      id: msg.id,
      json: { status: 200, headers: { 'x-index': `${i}` }, body: resultFn ? resultFn(msg.id, i) : `result-${i}` },
      binary: undefined,
    })),
  }
}

function makeTransport(): StandardLinkTransport<TestContext> {
  return {
    send: vi.fn<StandardLinkTransport<TestContext>['send']>(async (request) => {
      if (request.headers['orpc-batch']) {
        return makeBufferedBatchResponseFromRequest(request)
      }

      return {
        status: 200,
        headers: {},
        resolveBody: async () => 'not-batched',
      }
    }),
  }
}

async function toLengthPrefixedBytes(messages: any[]): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []

  for (const message of messages) {
    const encoded = await encodePeerMessage(message)
    const bytes = typeof encoded === 'string' ? new TextEncoder().encode(encoded) : encoded
    const header = new ArrayBuffer(4)
    new DataView(header).setUint32(0, bytes.byteLength, false)

    chunks.push(new Uint8Array(header), bytes)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }

  return output
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('batchLinkPlugin', () => {
  const defaultGroup = {
    condition: () => true,
    context: () => ({}),
  }

  describe('request filtering and pass-through', () => {
    it('passes through requests when filter returns false', async () => {
      const codec = makeCodec()
      const transport = makeTransport()
      const filter = vi.fn(() => false)
      const condition = vi.fn(() => true)

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [{ condition, context: () => ({}) }],
          filter,
        })],
      })

      await Promise.all([
        expect(link.call(['ping'], {}, { context: {} })).resolves.toBe('not-batched'),
        expect(link.call(['ping'], {}, { context: {} })).resolves.toBe('not-batched'),
      ])

      expect(filter).toHaveBeenCalledTimes(2)
      expect(condition).not.toHaveBeenCalled()
      expect(transport.send).toHaveBeenCalledTimes(2)
      expect(vi.mocked(transport.send).mock.calls[0]![0].headers['orpc-batch']).toBeUndefined()
      expect(vi.mocked(transport.send).mock.calls[1]![0].headers['orpc-batch']).toBeUndefined()
    })

    it('passes through requests when no group matches', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [{ condition: () => false, context: () => ({}) }],
        })],
      })

      await Promise.all([
        expect(link.call(['ping'], {}, { context: {} })).resolves.toBe('not-batched'),
        expect(link.call(['ping'], {}, { context: {} })).resolves.toBe('not-batched'),
      ])

      expect(transport.send).toHaveBeenCalledTimes(2)
    })

    it('passes through a single request without batching', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      await expect(link.call(['ping'], {}, { context: {} })).resolves.toBe('not-batched')
      expect(transport.send).toHaveBeenCalledTimes(1)
    })

    it('skips batching for requests with Blob body', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(codec.encodeInput).mockResolvedValueOnce({
        method: 'POST',
        url: '/upload',
        headers: {},
        body: new Blob(['data']),
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      await Promise.all([
        expect(link.call(['upload'], {}, { context: {} })).resolves.toBe('not-batched'),
        expect(link.call(['upload'], {}, { context: {} })).resolves.toBe('not-batched'),
      ])

      expect(transport.send).toHaveBeenCalledTimes(2)
    })

    it('skips batching for requests with ReadableStream body', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(codec.encodeInput).mockResolvedValueOnce({
        method: 'POST',
        url: '/stream-upload',
        headers: {},
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            controller.close()
          },
        }),
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      await Promise.all([
        expect(link.call(['upload-stream'], {}, { context: {} })).resolves.toBe('not-batched'),
        expect(link.call(['upload-stream'], {}, { context: {} })).resolves.toBe('not-batched'),
      ])

      expect(transport.send).toHaveBeenCalledTimes(2)
    })

    it('skips batching for requests with AsyncIteratorObject body', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      async function* makeBody() {
        yield 'chunk'
      }

      vi.mocked(codec.encodeInput).mockResolvedValueOnce({
        method: 'POST',
        url: '/iterator-upload',
        headers: {},
        body: makeBody(),
      })

      vi.mocked(transport.send).mockResolvedValueOnce({
        status: 200,
        headers: {},
        resolveBody: async () => 'iterator-response',
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      const result = await link.call(['upload-iterator'], {}, { context: {} })
      expect(result).toBe('iterator-response')
      expect(transport.send).toHaveBeenCalledTimes(1)
      const sentRequest = vi.mocked(transport.send).mock.calls[0]![0]
      expect(sentRequest.headers['orpc-batch']).toBeUndefined()
    })

    it('skips batching when requests are already aborted', async () => {
      const codec = makeCodec()
      const transport = makeTransport()
      const requestController = new AbortController()
      requestController.abort()

      vi.mocked(codec.encodeInput).mockResolvedValueOnce({
        method: 'POST',
        url: '/encoded-aborted',
        headers: {},
        body: undefined,
        signal: requestController.signal,
      })

      vi.mocked(transport.send).mockResolvedValueOnce({
        status: 200,
        headers: {},
        resolveBody: async () => 'encoded-aborted-response',
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      await Promise.all([
        link.call(['ping'], {}, { context: {} }),
        link.call(['ping'], {}, { context: {} }),
      ])

      expect(transport.send).toHaveBeenCalledTimes(2) // no batching happen
    })
  })

  describe('batching and grouping behavior', () => {
    it('batches multiple concurrent requests', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
          mode: 'buffered',
        })],
      })

      await Promise.all([
        expect(link.call(['ping'], { n: 1 }, { context: {} })).resolves.toBe('result-0'),
        expect(link.call(['ping'], { n: 2 }, { context: {} })).resolves.toBe('result-1'),
      ])

      expect(transport.send).toHaveBeenCalledTimes(1)
      const sentRequest = vi.mocked(transport.send).mock.calls[0]![0]
      expect(sentRequest.headers['orpc-batch']).toBe('buffered')
    })

    it('splits batches when exceeding maxSize', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
          mode: 'buffered',
          maxSize: 2,
        })],
      })

      // 4 concurrent requests with maxSize 2 should split into 2 batches of 2
      await Promise.all([
        link.call(['a'], {}, { context: {} }),
        link.call(['b'], {}, { context: {} }),
        link.call(['c'], {}, { context: {} }),
        link.call(['d'], {}, { context: {} }),
      ])

      expect(transport.send).toHaveBeenCalledTimes(2)
    })

    it('deduplicates common headers in batch requests', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      let callIndex = 0
      vi.mocked(codec.encodeInput).mockImplementation(async () => {
        callIndex++
        return {
          method: 'POST',
          url: `/test-${callIndex}` as `/${string}`,
          headers: {
            'authorization': 'Bearer token123',
            'x-unique': `value-${callIndex}`,
          },
          body: undefined,
        }
      })

      vi.mocked(transport.send).mockImplementation(async (request) => {
        return makeBufferedBatchResponseFromRequest(request)
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      await Promise.all([
        link.call(['a'], {}, { context: {} }),
        link.call(['b'], {}, { context: {} }),
      ])

      expect(transport.send).toHaveBeenCalledTimes(1)

      const sentRequest = vi.mocked(transport.send).mock.calls[0]![0]
      expect(sentRequest.headers.authorization).toBe('Bearer token123')
      expect(sentRequest.headers['x-unique']).toBeUndefined()
    })

    it('low-priority merge batch response headers into subresponse', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        const response = makeBufferedBatchResponseFromRequest(request)
        return {
          ...response,
          headers: {
            ...response.headers,
            'x-from-batch-response': 'true',
            'x-index': 'low-priority',
          },
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
        })],
      })

      await Promise.all([
        link.call(['a'], {}, { context: {} }),
        link.call(['b'], {}, { context: {} }),
      ])

      expect(codec.decodeResponse).toHaveBeenCalledTimes(2)
      const subResponse1 = vi.mocked(codec.decodeResponse).mock.calls[0]![0]
      const subResponse2 = vi.mocked(codec.decodeResponse).mock.calls[1]![0]

      expect(subResponse1.headers['x-from-batch-response']).toEqual('true')
      expect(subResponse1.headers['x-index']).toEqual('0')

      expect(subResponse2.headers['x-from-batch-response']).toEqual('true')
      expect(subResponse2.headers['x-index']).toEqual('1')
    })

    it('separates GET and POST requests into distinct batches', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      let callIndex = 0
      vi.mocked(codec.encodeInput).mockImplementation(async () => {
        callIndex++
        const method = callIndex <= 2 ? 'GET' : 'POST'
        return {
          method,
          url: `/test-${callIndex}` as `/${string}`,
          headers: {},
          body: undefined,
        }
      })

      vi.mocked(transport.send).mockImplementation(async (request) => {
        if (request.headers['orpc-batch']) {
          return makeBufferedBatchResponseFromRequest(request)
        }
        return { status: 200, headers: {}, resolveBody: async () => 'direct' }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
          mode: 'buffered',
        })],
      })

      await Promise.all([
        link.call(['get1'], {}, { context: {} }),
        link.call(['get2'], {}, { context: {} }),
        link.call(['post1'], {}, { context: {} }),
        link.call(['post2'], {}, { context: {} }),
      ])

      // Should have at least 2 batch calls: one for GET, one for POST
      expect(transport.send).toHaveBeenCalledTimes(2)

      const sentGetRequest = vi.mocked(transport.send).mock.calls.find(([request]) => request.method === 'GET')![0]
      expect(sentGetRequest).toBeDefined()
      expect(sentGetRequest.headers['orpc-batch']).toBe('buffered')

      const sentPostRequest = vi.mocked(transport.send).mock.calls.find(([request]) => request.method === 'POST')![0]
      expect(sentPostRequest).toBeDefined()
      expect(sentPostRequest.headers['orpc-batch']).toBe('buffered')
    })

    it('aborts grouped batch request when all sub-requests are aborted', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        await sleep(50)
        request.signal?.throwIfAborted()

        return {
          status: 207,
          headers: {},
          resolveBody: async () => [],
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'streaming' })],
      })

      const controller1 = new AbortController()
      const controller2 = new AbortController()

      const promise = Promise.all([
        expect(link.call(['a'], {}, { context: {}, signal: controller1.signal })).rejects.toThrow('aborted'),
        expect(link.call(['b'], {}, { context: {}, signal: controller2.signal })).rejects.toThrow('aborted'),
      ])

      await sleep(10)
      expect(vi.mocked(transport.send)).toHaveBeenCalledTimes(1)

      controller1.abort()
      await sleep(10)
      expect(vi.mocked(transport.send).mock.calls[0]![0].signal?.aborted).toBe(false)

      controller2.abort()
      await sleep(10)
      expect(vi.mocked(transport.send).mock.calls[0]![0].signal?.aborted).toBe(true)

      await promise
    })
  })

  describe('batch response decoding', () => {
    it('decodes length-prefixed blob batch responses', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        if (!request.headers['orpc-batch']) {
          return { status: 200, headers: {}, resolveBody: async () => 'direct' }
        }

        const rawMessages = Array.isArray(request.body) ? request.body : []
        const responseMessages = rawMessages.map((msg: any, i: number) => ({
          kind: 'response',
          id: msg.id,
          json: { status: 200, headers: {}, body: `blob-${i}` },
        }))

        const bytes = await toLengthPrefixedBytes(responseMessages)

        return {
          status: 207,
          headers: {},
          resolveBody: async () => new Blob([bytes], { type: 'application/octet-stream' }),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).resolves.toBe('blob-0'),
        expect(link.call(['b'], {}, { context: {} })).resolves.toBe('blob-1'),
      ])
    })

    it('decodes length-prefixed stream batch responses', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        if (!request.headers['orpc-batch']) {
          return { status: 200, headers: {}, resolveBody: async () => 'direct' }
        }

        const rawMessages = Array.isArray(request.body) ? request.body : []
        const responseMessages = rawMessages.map((msg: any, i: number) => ({
          kind: 'response',
          id: msg.id,
          json: { status: 200, headers: {}, body: `stream-${i}` },
        }))

        const bytes = await toLengthPrefixedBytes(responseMessages)
        const splitAt = Math.max(1, Math.floor(bytes.length / 2))

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, splitAt))
            controller.enqueue(bytes.subarray(splitAt))
            controller.close()
          },
        })

        return {
          status: 207,
          headers: {},
          resolveBody: async () => stream,
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'streaming' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).resolves.toBe('stream-0'),
        expect(link.call(['b'], {}, { context: {} })).resolves.toBe('stream-1'),
      ])
    })

    it('ignores zero-length keep-alive frames in stream batch responses', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        if (!request.headers['orpc-batch']) {
          return { status: 200, headers: {}, resolveBody: async () => 'direct' }
        }

        const rawMessages = Array.isArray(request.body) ? request.body : []
        const responseMessages = rawMessages.map((msg: any, i: number) => ({
          kind: 'response',
          id: msg.id,
          json: { status: 200, headers: {}, body: `keepalive-${i}` },
        }))

        const bytes = await toLengthPrefixedBytes(responseMessages)
        const keepAlive = new Uint8Array([0, 0, 0, 0])

        // Keep-alive frames only appear between complete length-prefixed messages
        // (never between a length header and its payload).
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(keepAlive)
            controller.enqueue(bytes)
            controller.enqueue(keepAlive)
            controller.close()
          },
        })

        return {
          status: 207,
          headers: {},
          resolveBody: async () => stream,
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'streaming' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).resolves.toBe('keepalive-0'),
        expect(link.call(['b'], {}, { context: {} })).resolves.toBe('keepalive-1'),
      ])
    })

    it('ignores zero-length keep-alive frames in blob batch responses', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        if (!request.headers['orpc-batch']) {
          return { status: 200, headers: {}, resolveBody: async () => 'direct' }
        }

        const rawMessages = Array.isArray(request.body) ? request.body : []
        const responseMessages = rawMessages.map((msg: any, i: number) => ({
          kind: 'response',
          id: msg.id,
          json: { status: 200, headers: {}, body: `blob-ka-${i}` },
        }))

        const bytes = await toLengthPrefixedBytes(responseMessages)
        const keepAlive = new Uint8Array([0, 0, 0, 0])
        const withKeepAlives = new Uint8Array(keepAlive.length + bytes.length + keepAlive.length)
        withKeepAlives.set(keepAlive, 0)
        withKeepAlives.set(bytes, keepAlive.length)
        withKeepAlives.set(keepAlive, keepAlive.length + bytes.length)

        return {
          status: 207,
          headers: {},
          resolveBody: async () => new Blob([withKeepAlives], { type: 'application/octet-stream' }),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).resolves.toBe('blob-ka-0'),
        expect(link.call(['b'], {}, { context: {} })).resolves.toBe('blob-ka-1'),
      ])
    })

    it('decodes streamed responses when length header and payload arrive in separate chunks', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async (request) => {
        if (!request.headers['orpc-batch']) {
          return { status: 200, headers: {}, resolveBody: async () => 'direct' }
        }

        const rawMessages = Array.isArray(request.body) ? request.body : []
        const responseMessages = rawMessages.map((msg: any, i: number) => ({
          kind: 'response',
          id: msg.id,
          json: { status: 200, headers: {}, body: `split-${i}` },
        }))

        const bytes = await toLengthPrefixedBytes(responseMessages)

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // Send only length header first, then payload bytes.
            controller.enqueue(bytes.subarray(0, 4))
            controller.enqueue(bytes.subarray(4))
            controller.close()
          },
        })

        return {
          status: 207,
          headers: {},
          resolveBody: async () => stream,
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'streaming' })],
      })

      await Promise.all([
        expect(link.call(['x'], {}, { context: {} })).resolves.toBe('split-0'),
        expect(link.call(['y'], {}, { context: {} })).resolves.toBe('split-1'),
      ])
    })

    it('rejects on malformed array batch responses with invalid messages', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        return {
          status: 207,
          headers: {},
          resolveBody: async () => ['INVALID', 'INVALID'],
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Invalid batch response format'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Invalid batch response format'),
      ])
    })

    it('rejects on malformed blob batch responses with incomplete headers', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        return {
          status: 207,
          headers: {},
          resolveBody: async () => new Blob([new Uint8Array([1, 2, 3])]),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Invalid batch response: incomplete length header.'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Invalid batch response: incomplete length header.'),
      ])
    })

    it('rejects on malformed blob batch responses with incomplete messages', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        return {
          status: 207,
          headers: {},
          resolveBody: async () => new Blob(['MALFORMED']),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Invalid batch response: incomplete message.'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Invalid batch response: incomplete message.'),
      ])
    })

    it('rejects on malformed blob batch responses with invalid messages', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        const bytes = await toLengthPrefixedBytes(['INVALID', 'INVALID'])

        return {
          status: 207,
          headers: {},
          resolveBody: async () => new Blob([bytes], { type: 'application/octet-stream' }),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Invalid batch response: invalid message.'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Invalid batch response: invalid message.'),
      ])
    })

    it('rejects on malformed streamed batch responses with incomplete headers', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        return {
          status: 207,
          headers: {},
          resolveBody: async () => new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]))
              controller.close()
            },
          }),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Batch response is incomplete.'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Batch response is incomplete.'),
      ])
    })

    it('rejects on malformed streamed batch responses with incomplete messages', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        return {
          status: 207,
          headers: {},
          resolveBody: async () => new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('MALFORMED'))
              controller.close()
            },
          }),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Batch response is incomplete.'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Batch response is incomplete.'),
      ])
    })

    it('rejects on malformed streamed batch responses with invalid messages', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        const bytes = await toLengthPrefixedBytes(['INVALID', 'INVALID'])

        return {
          status: 207,
          headers: {},
          resolveBody: async () => new ReadableStream({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          }),
        }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({ groups: [defaultGroup], mode: 'buffered' })],
      })

      await Promise.all([
        expect(link.call(['a'], {}, { context: {} })).rejects.toThrow('Invalid batch response: invalid message.'),
        expect(link.call(['b'], {}, { context: {} })).rejects.toThrow('Invalid batch response: invalid message.'),
      ])
    })
  })

  describe('method GET batch URL handling', () => {
    it('splits GET batches when URL exceeds maxUrlLength', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(codec.encodeInput).mockImplementation(async (_input, path) => ({
        method: 'GET',
        url: `/${path.join('/')}` as `/${string}`,
        headers: {},
        body: undefined,
      }))

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
          mode: 'buffered',
          maxUrlLength: 1,
        })],
      })

      await Promise.all([
        expect(link.call(['get-a'], {}, { context: {} })).resolves.toBe('not-batched'),
        expect(link.call(['get-b'], {}, { context: {} })).resolves.toBe('not-batched'),
      ])
    })

    it('appends batch data to existing query params and preserves hash', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(codec.encodeInput).mockImplementation(async (_input, path) => ({
        method: 'GET',
        url: `/${path.join('/')}` as `/${string}`,
        headers: {},
        body: undefined,
      }))

      vi.mocked(transport.send).mockImplementation(async (request) => {
        return makeBufferedBatchResponseFromRequest(request)
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
          mode: 'buffered',
          url: () => '/custom/__batch__?existing=1#anchor',
        })],
      })

      await Promise.all([
        expect(link.call(['q1'], {}, { context: {} })).resolves.toBe('result-0'),
        expect(link.call(['q2'], {}, { context: {} })).resolves.toBe('result-1'),
      ])

      expect(transport.send).toHaveBeenCalledTimes(1)
      const sentRequest = vi.mocked(transport.send).mock.calls[0]![0]
      expect(sentRequest.url).toContain('/custom/__batch__?existing=1&data=')
      expect(sentRequest.url).toContain('#anchor')
    })

    it('appends batch data to existing query params without hash', async () => {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(codec.encodeInput).mockImplementation(async (_input, path) => ({
        method: 'GET',
        url: `/${path.join('/')}` as `/${string}`,
        headers: {},
        body: undefined,
      }))

      vi.mocked(transport.send).mockImplementation(async (request) => {
        return makeBufferedBatchResponseFromRequest(request)
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new BatchLinkPlugin({
          groups: [defaultGroup],
          mode: 'buffered',
          url: () => '/custom-no-hash/__batch__?existing=1',
        })],
      })

      await Promise.all([
        expect(link.call(['q3'], {}, { context: {} })).resolves.toBe('result-0'),
        expect(link.call(['q4'], {}, { context: {} })).resolves.toBe('result-1'),
      ])

      expect(transport.send).toHaveBeenCalledTimes(1)
      const sentRequest = vi.mocked(transport.send).mock.calls[0]![0]
      expect(sentRequest.url).toContain('/custom-no-hash/__batch__?existing=1&data=')
      expect(sentRequest.url).not.toContain('#')
    })
  })
})
