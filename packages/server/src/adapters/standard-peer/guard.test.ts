import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { ClientPeerSendMessage, ServerPeerSendMessage } from '@standard-server/peer'
import { ORPCError, RPCSerializer } from '@orpc/client'
import { ServerPeer } from '@standard-server/peer'
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

function createConnection(options: ConstructorParameters<typeof StandardPeerGuard>[0] = {}) {
  const guard = new StandardPeerGuard(options)
  const sent: ServerPeerSendMessage[] = []
  const peer = new ServerPeer(async (message) => {
    sent.push(message)
  })

  /**
   * Sends a message through the guard and returns the request the handler received.
   */
  const message = (message: ClientPeerSendMessage, size = 0, handle?: (request: StandardLazyRequest) => Promise<StandardResponse>) => {
    let received: StandardLazyRequest | undefined

    const promise = guard.message(peer, message, async (request) => {
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
    peer,
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
      const guard = new StandardPeerGuard({ maxConcurrentRequests: 2, sendHighWaterMark: 0 })
      const sent: ServerPeerSendMessage[] = []
      const peer = new ServerPeer(message => guard.send(() => sent.push(message), () => bufferedAmount))
      const handle = vi.fn(() => new Promise<never>(() => {}))

      guard.message(peer, plainRequest('active-1'), handle, 0)
      guard.message(peer, plainRequest('active-2'), handle, 0)

      // the client stops reading, requests keep arriving one I/O event at a time
      bufferedAmount = 1
      for (let i = 0; i < 10; i++) {
        guard.message(peer, eventStreamRequest(String(i)), handle, 0)
        await tick()
      }

      expect((guard as any).pendingRejections).toBe(2)

      bufferedAmount = 0
      await vi.waitFor(() => expect(sent.filter(m => m.kind === 'response')).toHaveLength(2))
      await tick(50)
      expect(sent.filter(m => m.kind === 'response')).toHaveLength(2)
      // the streamed input of the rejected requests was discarded at once
      expect(sent.filter(m => m.kind === 'stream/cancel').map(m => m.id)).toEqual(['0', '1'])
      expect(handle).toHaveBeenCalledTimes(2)
      expect((guard as any).pendingRejections).toBe(0)
    })

    it('leaves no accounting behind for a rejected streamed request', async () => {
      const { message, sent, buffered, cancelled } = createConnection({ maxConcurrentRequests: 1, maxBufferedStreamSize: 1000 })

      message(plainRequest('active'))
      await message(eventStreamRequest('1')).promise

      expect(cancelled('1')).toBe(true)
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

      guard.close()
      await expect(iterator.next()).resolves.toEqual({ done: false, value: 'data' })
      expect(buffered()).toBe(0)
    })

    it('returns a body that is not a stream as is', async () => {
      const guard = new StandardPeerGuard({ maxBufferedStreamSize: 1000 })
      let body: unknown

      await guard.message({
        message: async (_, handleRequest) => {
          await handleRequest({ url: '/', method: 'POST', headers: {}, resolveBody: async () => 'not a stream' })
        },
      }, eventStreamRequest('1'), async (request) => {
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
      const { message, buffered, peer } = createConnection({ maxBufferedStreamSize: 1000 })

      const { request } = message(octetStreamRequest('1'))
      const reader = (await request().resolveBody() as ReadableStream<Uint8Array>).getReader()
      await message(octet('1', new Uint8Array(1)), 100).promise
      await expect(reader.read()).resolves.toMatchObject({ done: false })
      const pending = reader.read()

      await peer.close(new Error('closed'))
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

      guard.close()
      expect(buffered()).toBe(0)
      expect((guard as any).streams.size).toBe(0)
    })

    it('keeps the accounting of a newer request reusing an id', async () => {
      const guard = new StandardPeerGuard({ maxBufferedStreamSize: 1000 })
      const settles: (() => void)[] = []

      // a peer that already forgot the first request when the second one arrives
      const peer = {
        message: (message: ClientPeerSendMessage, handleRequest: (request: StandardLazyRequest) => Promise<StandardResponse>) => {
          if (message.kind === 'request') {
            void handleRequest({ url: '/', method: 'POST', headers: {}, resolveBody: async () => undefined })
          }

          return new Promise<void>(resolve => settles.push(resolve))
        },
      }

      const handle = async () => ({ status: 200, headers: {}, body: undefined })
      const first = guard.message(peer, eventStreamRequest('1'), handle, 0)
      const older = (guard as any).streams.get('1')
      void guard.message(peer, eventStreamRequest('1'), handle, 0)
      const newer = (guard as any).streams.get('1')
      expect(newer).not.toBe(older)

      settles[0]!()
      await first

      expect((guard as any).streams.get('1')).toBe(newer)
      void guard.message(peer, event('1'), handle, 100)
      expect((guard as any).budget.size).toBe(100 + OVERHEAD)
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

  describe('.send', () => {
    it('sends right away when the buffered amount is unknown or below the mark', async () => {
      const guard = new StandardPeerGuard({ sendHighWaterMark: 10 })
      const send = vi.fn()

      await guard.send(send, () => undefined)
      await guard.send(send, () => 10)

      expect(send).toHaveBeenCalledTimes(2)
    })

    it('drops the message once the connection is closed', async () => {
      const guard = new StandardPeerGuard()
      const send = vi.fn()

      await guard.send(send, () => null)
      await guard.send(send, () => {
        throw new Error('closed')
      })

      expect(send).not.toHaveBeenCalled()
    })

    it('never waits with Infinity', async () => {
      const guard = new StandardPeerGuard({ sendHighWaterMark: Infinity })
      const send = vi.fn()

      await guard.send(send, () => Number.MAX_SAFE_INTEGER)
      guard.close()
      await guard.send(send, () => null)

      expect(send).toHaveBeenCalledTimes(2)
    })

    it('waits while above the mark and lets one waiter send per drain', async () => {
      const guard = new StandardPeerGuard({ sendHighWaterMark: 10 })
      let bufferedAmount = 11
      const send = vi.fn(() => {
        bufferedAmount += 11
      })

      const sends = [1, 2, 3].map(() => guard.send(send, () => bufferedAmount))

      await tick(50)
      expect(send).not.toHaveBeenCalled()

      bufferedAmount = 0
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await tick(50)
      expect(send).toHaveBeenCalledTimes(1)

      bufferedAmount = 0
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

      guard.close()
      await Promise.all(sends)
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('shares one drain wait between waiters and survives its rejection', async () => {
      const guard = new StandardPeerGuard({ sendHighWaterMark: 10 })
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

      await Promise.all([
        guard.send(send, () => bufferedAmount, waitForDrain),
        guard.send(send, () => bufferedAmount, waitForDrain),
      ])

      expect(waitForDrain).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('stops waiting without sending or rejecting once closed', async () => {
      const guard = new StandardPeerGuard()
      const send = vi.fn()

      const promise = guard.send(send, () => Number.MAX_SAFE_INTEGER)
      await tick(30)
      guard.close()

      await expect(promise).resolves.toBeUndefined()
      expect(send).not.toHaveBeenCalled()

      await guard.send(send, () => 0)
      expect(send).not.toHaveBeenCalled()
    })

    it('stops waiting once the connection closes', async () => {
      const guard = new StandardPeerGuard()
      const send = vi.fn()
      let bufferedAmount: number | null = Number.MAX_SAFE_INTEGER

      const promise = guard.send(send, () => bufferedAmount)
      await tick(30)
      bufferedAmount = null

      await expect(promise).resolves.toBeUndefined()
      expect(send).not.toHaveBeenCalled()
    })

    it('propagates errors from send', async () => {
      const guard = new StandardPeerGuard()

      await expect(guard.send(() => {
        throw new Error('send failed')
      }, () => 0)).rejects.toThrow('send failed')
    })
  })
})
