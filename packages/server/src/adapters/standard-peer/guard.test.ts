import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { ClientPeerSendMessage, ServerPeerSendMessage } from '@standard-server/peer'
import { ORPCError, RPCSerializer } from '@orpc/client'
import { StandardPeerGuard } from './guard'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

function eventStreamRequest(id: string, extra: object = {}): ClientPeerSendMessage {
  return { id, kind: 'request', json: { url: '/', headers: { 'standard-server': 'event-stream' }, ...extra } }
}
function octetStreamRequest(id: string): ClientPeerSendMessage {
  return { id, kind: 'request', json: { url: '/', headers: { 'content-type': 'application/octet-stream' } } }
}
function plainRequest(id: string): ClientPeerSendMessage {
  return { id, kind: 'request', json: { url: '/', body: 'body' } }
}
function event(id: string, data: unknown = 'data', type?: 'close' | 'error'): ClientPeerSendMessage {
  return { id, kind: 'event-stream', json: { event: type, data } }
}
function octet(id: string, binary?: Uint8Array<ArrayBuffer>, close?: true): ClientPeerSendMessage {
  return { id, kind: 'octet-stream', json: { close }, binary }
}

/**
 * Every message costs its given size plus this overhead.
 */
const OVERHEAD = 128

function createConnection(
  options: ConstructorParameters<typeof StandardPeerGuard>[1] = {},
  getBufferedAmount?: () => number | null | undefined,
) {
  const sent: ServerPeerSendMessage[] = []
  const guard = new StandardPeerGuard({
    send: (message, sendWhenDrained) => sendWhenDrained(() => sent.push(message)),
    getBufferedAmount,
  }, options)

  /**
   * Sends a message through the guard and returns the request the handler received.
   */
  const message = (message: ClientPeerSendMessage, size = 0, handle?: (request: StandardLazyRequest) => Promise<StandardResponse>) => {
    let received: StandardLazyRequest | undefined

    const promise = guard.message(message, async (request) => {
      received = request
      // by default, stay in flight until aborted
      return handle
        ? handle(request)
        : new Promise(resolve => request.signal?.addEventListener('abort', () => resolve({ status: 200, headers: {}, body: undefined })))
    }, size)

    return { promise, request: () => received! }
  }

  return {
    guard,
    sent,
    message,
    buffered: () => (guard as any).budget.size as number,
    cancelled: (id: string) => sent.some(m => m.id === id && m.kind === 'stream/cancel'),
  }
}

describe('standardPeerGuard', () => {
  describe('maxConcurrentRequests', () => {
    it('answers requests above the limit with a typed 429 without handling them', async () => {
      const { message, sent } = createConnection({ maxConcurrentRequests: 2 })
      const handled = vi.fn()

      for (let i = 0; i < 3; i++) {
        message(plainRequest(String(i)), 0, async (request) => {
          handled(request.url)
          return new Promise(() => {})
        })
      }

      await vi.waitFor(() => expect(sent).toHaveLength(1))
      expect(handled).toHaveBeenCalledTimes(2)
      expect(sent[0]).toEqual({
        id: '2',
        kind: 'response',
        json: {
          status: 429,
          body: new RPCSerializer().serialize(new ORPCError('TOO_MANY_REQUESTS').toJSON()),
        },
      })
    })

    it('frees a slot once a request settles, including on cancel', async () => {
      const { message, sent } = createConnection({ maxConcurrentRequests: 1 })

      const first = message(plainRequest('1'))
      message(plainRequest('2'))
      await vi.waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]).toMatchObject({ id: '2', json: { status: 429 } })

      await message({ id: '1', kind: 'cancel' }).promise
      await first.promise

      message(plainRequest('3'), 0, async () => ({ status: 200, headers: {}, body: 'ok' }))
      await vi.waitFor(() => expect(sent).toHaveLength(2))
      expect(sent[1]).toEqual({ id: '3', kind: 'response', json: { body: 'ok' } })
    })

    it('ignores a duplicate id while at the limit instead of answering it', async () => {
      const { message, sent } = createConnection({ maxConcurrentRequests: 1 })

      message(plainRequest('1'))
      await message(plainRequest('1')).promise

      expect(sent).toEqual([])
    })

    it('drops requests once as many rejections wait for a client that does not read', async () => {
      let bufferedAmount = 0
      const { guard, message, sent } = createConnection({ maxConcurrentRequests: 2, sendHighWaterMark: 0 }, () => bufferedAmount)
      const handle = vi.fn(() => new Promise<never>(() => {}))

      message(plainRequest('active-1'), 0, handle)
      message(plainRequest('active-2'), 0, handle)

      // the client stops reading, requests keep arriving one I/O event at a time
      bufferedAmount = 1
      for (let i = 0; i < 10; i++) {
        message(eventStreamRequest(String(i)))
        await tick()
      }

      expect((guard as any).pendingRejections).toBe(2)

      bufferedAmount = 0
      await vi.waitFor(() => expect(sent.filter(m => m.kind === 'response')).toHaveLength(2))
      await tick(50)
      expect(sent.filter(m => m.kind === 'response').map(m => m.id)).toEqual(['0', '1'])
      // the streamed input of the rejected requests was cancelled too
      expect(sent.filter(m => m.kind === 'stream/cancel').map(m => m.id)).toEqual(['0', '1'])
      expect(handle).toHaveBeenCalledTimes(2)
      expect((guard as any).pendingRejections).toBe(0)
    })

    it('leaves no accounting behind for a rejected streamed request', async () => {
      const { message, sent, buffered, cancelled } = createConnection({ maxConcurrentRequests: 1, maxBufferedStreamSize: 1000 })

      message(plainRequest('active'))
      await message(eventStreamRequest('1')).promise

      await vi.waitFor(() => expect(cancelled('1')).toBe(true))
      expect(sent.find(m => m.id === '1' && m.kind === 'response')).toMatchObject({ json: { status: 429 } })

      await message(event('1'), 10_000).promise
      expect(buffered()).toBe(0)
    })

    it('does not limit requests with Infinity', async () => {
      const { message, sent } = createConnection({ maxConcurrentRequests: Infinity })
      const handle = vi.fn(() => new Promise<never>(() => {}))

      for (let i = 0; i < 1000; i++) {
        message(plainRequest(String(i)), 0, handle)
      }

      await tick()
      expect(handle).toHaveBeenCalledTimes(1000)
      expect(sent).toEqual([])
    })
  })

  describe('maxBufferedStreamSize', () => {
    it('releases event-stream messages as the procedure reads them', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>

      for (let i = 0; i < 100; i++) {
        await message(event('1', i), 500).promise
        expect(buffered()).toBe(500 + OVERHEAD)
        await expect(iterator.next()).resolves.toEqual({ done: false, value: i })
        expect(buffered()).toBe(0)
      }

      await message(event('1', 'last', 'close'), 500).promise
      await expect(iterator.next()).resolves.toEqual({ done: true, value: 'last' })
      expect(buffered()).toBe(0)
      expect(cancelled('1')).toBe(false)
    })

    it('releases the oldest message first across many buffered messages', async () => {
      const { message, buffered } = createConnection({ maxBufferedStreamSize: Number.MAX_SAFE_INTEGER })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>

      const sizes = Array.from({ length: 3000 }, (_, i) => i % 7)
      for (const size of sizes) {
        await message(event('1'), size).promise
      }

      let remaining = sizes.reduce((sum, size) => sum + size + OVERHEAD, 0)
      expect(buffered()).toBe(remaining)

      for (const size of sizes) {
        await iterator.next()
        remaining -= size + OVERHEAD
        expect(buffered()).toBe(remaining)
      }
    })

    it('ignores reads after the input was released', async () => {
      const { guard, message, buffered } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>
      await message(event('1'), 100).promise
      await message(event('1'), 100).promise

      // the peer keeps already buffered messages readable after closing
      await guard.close()
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 'data' })
      expect(buffered()).toBe(0)
    })

    it('returns a body that is not a stream as is', async () => {
      const { guard } = createConnection({ maxBufferedStreamSize: 1000 })
      let body: unknown

      ;(guard as any).peer = {
        message: async (_: unknown, handleRequest: (request: StandardLazyRequest) => Promise<StandardResponse>) => {
          await handleRequest({ url: '/', method: 'POST', headers: {}, resolveBody: async () => 'not a stream' })
        },
      }

      await guard.message(eventStreamRequest('1'), async (request) => {
        body = await request.resolveBody()
        return { status: 200, headers: {}, body: undefined }
      }, 0)

      expect(body).toBe('not a stream')
    })

    it('cancels unread input exceeding the limit and fails the next read', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>

      await message(event('1'), 300).promise
      await message(event('1'), 300).promise
      expect(buffered()).toBe(2 * (300 + OVERHEAD))
      expect(cancelled('1')).toBe(false)

      await message(event('1'), 300).promise
      expect(buffered()).toBe(0)
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))

      // later messages are dropped
      await message(event('1'), 300).promise
      expect(buffered()).toBe(0)

      await expect(iterator.next()).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
    })

    it('fails a read already waiting when the input is cancelled', async () => {
      const { message } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>
      const pending = iterator.next()

      // the procedure is still busy with an earlier item when a large message arrives
      await message(event('1'), 2000).promise

      await expect(pending).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
    })

    it('shares the limit across all requests of a connection', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      message(eventStreamRequest('1'))
      message(eventStreamRequest('2'))

      await message(event('1'), 600 - OVERHEAD).promise
      await message(event('2'), 600 - OVERHEAD).promise

      expect(buffered()).toBe(600)
      await vi.waitFor(() => expect(cancelled('2')).toBe(true))
      expect(cancelled('1')).toBe(false)
    })

    it('resolves and cancels a body nobody has read yet', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1', { method: 'GET' }))
      await message(event('1'), 2000).promise

      expect(buffered()).toBe(0)
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))

      // reading it later still reports why
      const iterator = await request().resolveBody() as AsyncIterator<unknown>
      await expect(iterator.next()).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
    })

    it('cancels a body being resolved when the limit is exceeded', async () => {
      const { message, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1'))
      const body = request().resolveBody()
      await message(event('1'), 2000).promise

      const iterator = await body as AsyncIterator<unknown>
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))
      await expect(iterator.next()).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
    })

    it('releases octet-stream chunks as they are read and on a binary-less close message', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(octetStreamRequest('1'))
      const reader = (await request().resolveBody() as ReadableStream<Uint8Array>).getReader()

      await message(octet('1', new Uint8Array([1])), 100).promise
      await message(octet('1', new Uint8Array([2])), 100).promise
      // the peer skips messages without binary and without `close`, which only over-estimates
      await message(octet('1'), 100).promise
      expect(buffered()).toBe(3 * (100 + OVERHEAD))

      await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([1]) })
      expect(buffered()).toBe(2 * (100 + OVERHEAD))

      await message(octet('1', undefined, true), 100).promise
      await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([2]) })
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      expect(buffered()).toBe(0)
      expect(cancelled('1')).toBe(false)
    })

    it('cancels unread octet-stream input exceeding the limit', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(octetStreamRequest('1'))
      const reader = (await request().resolveBody() as ReadableStream<Uint8Array>).getReader()
      const pending = reader.read()

      await message(octet('1', new Uint8Array(10)), 2000).promise

      expect(buffered()).toBe(0)
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))
      await expect(pending).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
      await expect(reader.read()).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
    })

    it('cancels an unread octet-stream body nobody has read yet', async () => {
      const { message, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(octetStreamRequest('1'))
      await message(octet('1', new Uint8Array(10)), 2000).promise
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))

      const reader = (await request().resolveBody() as ReadableStream<Uint8Array>).getReader()
      await expect(reader.read()).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'PAYLOAD_TOO_LARGE')
    })

    it.each([
      ['iterator', eventStreamRequest, event, async (body: any) => body.return()],
      ['stream', octetStreamRequest, (id: string) => octet(id, new Uint8Array(1)), async (body: any) => body.cancel()],
    ] as const)('releases accounting when the procedure cancels its %s input', async (_, createRequest, createMessage, cancel) => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(createRequest('1'))
      const body = await request().resolveBody()
      await message(createMessage('1'), 100).promise
      expect(buffered()).toBe(100 + OVERHEAD)

      await cancel(body)
      expect(buffered()).toBe(0)
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))

      // later messages are dropped
      await message(createMessage('1'), 100).promise
      expect(buffered()).toBe(0)
    })

    it('releases accounting when the client reports an error', async () => {
      const { message, buffered } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>
      await message(event('1', 'oops', 'error'), 100).promise
      await message(event('1'), 100).promise
      expect(buffered()).toBe(2 * (100 + OVERHEAD))

      await expect(iterator.next()).rejects.toMatchObject({ data: 'oops' })
      expect(buffered()).toBe(0)
    })

    it('releases accounting when a stream read fails', async () => {
      const { message, buffered, guard } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(octetStreamRequest('1'))
      const reader = (await request().resolveBody() as ReadableStream<Uint8Array>).getReader()
      await message(octet('1', new Uint8Array(1)), 100).promise
      await expect(reader.read()).resolves.toMatchObject({ done: false })
      const pending = reader.read()

      await (guard as any).peer.close(new Error('closed'))
      await expect(pending).rejects.toThrow('closed')
      expect(buffered()).toBe(0)
    })

    it('releases accounting when the request settles or the guard closes', async () => {
      const { guard, message, buffered } = createConnection({ maxBufferedStreamSize: 10_000 })

      const first = message(eventStreamRequest('1'), 0, async () => ({ status: 200, headers: {}, body: undefined }))
      await first.promise
      expect((guard as any).streams.size).toBe(0)

      message(eventStreamRequest('2'))
      await message(event('2'), 100).promise
      expect(buffered()).toBe(100 + OVERHEAD)

      await guard.close()
      expect(buffered()).toBe(0)
      expect((guard as any).streams.size).toBe(0)
    })

    it('keeps the accounting of a newer request reusing an id', async () => {
      const { guard, buffered } = createConnection({ maxBufferedStreamSize: 1000 })
      const settles: (() => void)[] = []

      // a peer that already forgot the first request when the second one arrives
      ;(guard as any).peer = {
        message: (message: ClientPeerSendMessage, handleRequest: (request: StandardLazyRequest) => Promise<StandardResponse>) => {
          if (message.kind === 'request') {
            void handleRequest({ url: '/', method: 'POST', headers: {}, resolveBody: async () => undefined })
          }

          return new Promise<void>(resolve => settles.push(resolve))
        },
      }

      const handle = async () => ({ status: 200, headers: {}, body: undefined })
      const first = guard.message(eventStreamRequest('1'), handle, 0)
      const older = (guard as any).streams.get('1')
      void guard.message(eventStreamRequest('1'), handle, 0)
      const newer = (guard as any).streams.get('1')
      expect(newer).not.toBe(older)

      settles[0]!()
      await first

      expect((guard as any).streams.get('1')).toBe(newer)
      void guard.message(event('1'), handle, 100)
      expect(buffered()).toBe(100 + OVERHEAD)
    })

    it('ignores messages the peer does not buffer', async () => {
      const { message, buffered } = createConnection({ maxBufferedStreamSize: 1000 })

      message(plainRequest('plain'))
      message({ id: 'empty', kind: 'request', json: { url: '/' } })
      message(eventStreamRequest('events'))

      await message(event('plain'), 10_000).promise
      await message(event('empty'), 10_000).promise
      await message(octet('events', new Uint8Array(1)), 10_000).promise
      await message(event('unknown'), 10_000).promise

      expect(buffered()).toBe(0)
    })

    it('lets the peer reject a repeated read', async () => {
      const { message } = createConnection()

      const { request } = message(eventStreamRequest('1'))
      await request().resolveBody()
      await expect(request().resolveBody()).rejects.toThrow('body stream already read')
    })

    it('does not track input with Infinity', async () => {
      const { message, buffered, cancelled } = createConnection({ maxBufferedStreamSize: Infinity })

      const { request } = message(eventStreamRequest('1'))
      const iterator = await request().resolveBody() as AsyncIterator<unknown>

      for (let i = 0; i < 100; i++) {
        await message(event('1', i), 1024 * 1024).promise
      }

      expect(buffered()).toBe(0)
      expect(cancelled('1')).toBe(false)
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 0 })
    })

    it('reads a size function only for stream messages', async () => {
      const { message, buffered } = createConnection({ maxBufferedStreamSize: 1000 })
      const size = vi.fn(() => 100)

      message(eventStreamRequest('1'), size as any)
      expect(size).not.toHaveBeenCalled()

      await message(event('1'), size as any).promise
      expect(size).toHaveBeenCalledTimes(1)
      expect(buffered()).toBe(100 + OVERHEAD)
    })
  })

  describe('send backpressure', () => {
    function createSender(
      options: ConstructorParameters<typeof StandardPeerGuard>[1],
      getBufferedAmount?: () => number | null | undefined,
      waitForDrain?: (threshold: number, signal: AbortSignal) => Promise<void>,
    ) {
      const guard = new StandardPeerGuard({ send: async () => {}, getBufferedAmount, waitForDrain }, options)
      const sendWhenDrained = (guard as any).sendWhenDrained as (send: () => unknown) => Promise<void>
      return { guard, sendWhenDrained }
    }

    it('sends right away when the buffered amount is unknown or at most the mark', async () => {
      const send = vi.fn()

      await createSender({ sendHighWaterMark: 10 }).sendWhenDrained(send)
      await createSender({ sendHighWaterMark: 10 }, () => undefined).sendWhenDrained(send)
      await createSender({ sendHighWaterMark: 10 }, () => 10).sendWhenDrained(send)

      expect(send).toHaveBeenCalledTimes(3)
    })

    it('drops the message once the connection is closed', async () => {
      const send = vi.fn()

      await createSender({}, () => null).sendWhenDrained(send)
      await createSender({}, () => {
        throw new Error('closed')
      }).sendWhenDrained(send)

      expect(send).not.toHaveBeenCalled()
    })

    it('never waits with Infinity', async () => {
      const send = vi.fn()
      const { guard, sendWhenDrained } = createSender({ sendHighWaterMark: Infinity }, () => Number.MAX_SAFE_INTEGER)

      await sendWhenDrained(send)
      await guard.close()
      await sendWhenDrained(send)

      expect(send).toHaveBeenCalledTimes(2)
    })

    it('sends waiting messages in order as the connection drains', async () => {
      let bufferedAmount = 11
      const sent: number[] = []
      const { guard, sendWhenDrained } = createSender({ sendHighWaterMark: 10 }, () => bufferedAmount)
      const send = (i: number) => () => {
        sent.push(i)
        bufferedAmount += 11
      }

      const sends = [1, 2, 3].map(i => sendWhenDrained(send(i)))

      await tick(50)
      expect(sent).toEqual([])

      bufferedAmount = 0
      await vi.waitFor(() => expect(sent).toEqual([1]))
      await tick(50)
      expect(sent).toEqual([1])

      // a new message waits behind the earlier ones
      bufferedAmount = 0
      sends.push(sendWhenDrained(send(4)))
      await vi.waitFor(() => expect(sent).toEqual([1, 2]))

      await guard.close()
      await Promise.all(sends)
      expect(sent).toEqual([1, 2])
    })

    it('checks the connection once per poll however many messages wait', async () => {
      const getBufferedAmount = vi.fn(() => Number.MAX_SAFE_INTEGER)
      const { guard, sendWhenDrained } = createSender({}, getBufferedAmount)

      const sends = Array.from({ length: 100 }, () => sendWhenDrained(() => {}))
      await tick(100)

      expect(getBufferedAmount.mock.calls.length).toBeLessThan(20)
      await guard.close()
      await Promise.all(sends)
    })

    it('uses one drain wait at a time and survives its rejection', async () => {
      let bufferedAmount = 11
      const send = vi.fn()
      const waitForDrain = vi.fn(async (threshold: number, signal: AbortSignal) => {
        expect(threshold).toBe(10)
        expect(signal.aborted).toBe(false)
        await tick(10)

        if (waitForDrain.mock.calls.length === 1) {
          throw new Error('wait failed')
        }

        bufferedAmount = 0
      })
      const { sendWhenDrained } = createSender({ sendHighWaterMark: 10 }, () => bufferedAmount, waitForDrain)

      await Promise.all([sendWhenDrained(send), sendWhenDrained(send)])

      expect(waitForDrain).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('stops waiting without sending or rejecting once closed', async () => {
      const send = vi.fn()
      const { guard, sendWhenDrained } = createSender({}, () => Number.MAX_SAFE_INTEGER)

      const promise = sendWhenDrained(send)
      await tick(30)
      await guard.close()

      await expect(promise).resolves.toBeUndefined()
      await sendWhenDrained(send)
      expect(send).not.toHaveBeenCalled()
    })

    it('stops waiting once the connection closes', async () => {
      const send = vi.fn()
      let bufferedAmount: number | null = Number.MAX_SAFE_INTEGER
      const { sendWhenDrained } = createSender({}, () => bufferedAmount)

      const promise = sendWhenDrained(send)
      await tick(30)
      bufferedAmount = null

      await expect(promise).resolves.toBeUndefined()
      expect(send).not.toHaveBeenCalled()
    })

    it('propagates errors from send', async () => {
      let bufferedAmount = 0
      const { sendWhenDrained } = createSender({ sendHighWaterMark: 10 }, () => bufferedAmount)
      const fail = () => {
        throw new Error('send failed')
      }

      await expect(sendWhenDrained(fail)).rejects.toThrow('send failed')

      bufferedAmount = 11
      const waiting = sendWhenDrained(fail)
      bufferedAmount = 0
      await expect(waiting).rejects.toThrow('send failed')
    })
  })
})
