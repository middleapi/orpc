import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
import crossws from 'crossws/adapters/node'
import WebSocket from 'ws'
import { os } from '../../builder'
import { experimental_RPCHandler as RPCHandler } from './rpc-handler'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

describe('rpcHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createHandler = (options: ConstructorParameters<typeof RPCHandler>[1] = {}) => {
    return new RPCHandler({
      ping: os.handler(async ({ signal }) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        signal?.throwIfAborted()

        return 'pong'
      }),
    }, options)
  }

  const createPeer = () => ({
    send: vi.fn(() => undefined),
  })

  const createMessage = async ({
    prefix,
    url = '/ping',
    rawData,
  }: {
    prefix?: string
    url?: `/${string}`
    rawData?: string | Uint8Array<ArrayBuffer>
  } = {}) => {
    const encoded = rawData ?? await encodePeerMessage({
      id: '19',
      kind: 'request',
      json: {
        url,
        body: { json: 'input' },
        headers: {},
        method: 'POST',
      },
    }, prefix ? { prefix } : undefined)

    return {
      rawData: encoded,
      uint8Array() {
        if (typeof this.rawData === 'string') {
          return new TextEncoder().encode(this.rawData)
        }

        return this.rawData
      },
    }
  }

  it('accepts context and prefix option in message method', async () => {
    const handler = new RPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const peer = createPeer()
    const message = await createMessage({ url: '/api/ping' })

    const result = await handler.message(peer, message, {
      context: { userId: 'u_123' },
      prefix: '/api',
    })

    expect(result.matched).toBe(true)
    expect(peer.send).toHaveBeenCalledTimes(1)

    const decoded = decodePeerMessage((peer as any).send.mock.calls[0][0]) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
    expect(decoded.message.json.body).toEqual({ json: 'u_123' })
  })

  it.each([
    ['string', () => createMessage()],
    ['bytes', async () => {
      const message = await createMessage()
      return {
        ...message,
        rawData: typeof message.rawData === 'string' ? new TextEncoder().encode(message.rawData) : message.rawData,
      }
    }],
  ])('handles %s request', async (_type, createMessage) => {
    const handler = createHandler()
    const peer = createPeer()
    const message = await createMessage()

    const result = await handler.message(peer as any, message)

    expect(result.matched).toBe(true)
    expect(peer.send).toHaveBeenCalledTimes(1)

    const decoded = decodePeerMessage((peer as any).send.mock.calls[0][0]) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
  })

  it('can decode messages with prefix', async () => {
    const handler = createHandler({
      decodePeerMessage: { prefix: 'orpc:' },
    })

    const peer = createPeer()
    const message = await createMessage()

    const result = await handler.message(peer as any, message as any)

    expect(result).toEqual({ matched: false })
    expect(peer.send).not.toHaveBeenCalled()

    const prefixedMessage = await createMessage({ prefix: 'orpc:' })

    const result2 = await handler.message(peer as any, prefixedMessage as any)

    expect(result2.matched).toBe(true)
    expect(peer.send).toHaveBeenCalledTimes(1)
  })

  it('can encode messages with prefix', async () => {
    const handler = createHandler({
      encodePeerMessage: { prefix: 'orpc:' },
    })

    const peer = createPeer()
    const message = await createMessage()

    const result = await handler.message(peer as any, message as any)

    expect(result.matched).toBe(true)
    expect(peer.send).toHaveBeenCalledTimes(1)

    const decoded = decodePeerMessage((peer as any).send.mock.calls[0][0], { prefix: 'orpc:' }) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
  })

  it('aborts in-flight request on close before response is sent', async () => {
    let signal: AbortSignal | undefined
    let releaseProcedure: (() => void) | undefined

    const procedureBlock = new Promise<void>((resolve) => {
      releaseProcedure = resolve
    })

    const handler = new RPCHandler({
      ping: os.handler(async ({ signal: procedureSignal }) => {
        signal = procedureSignal
        await procedureBlock
        signal?.throwIfAborted()

        return 'pong'
      }),
    })

    const peer = createPeer()
    const message = await createMessage()

    void handler.message(peer as any, message as any)

    await vi.waitFor(() => {
      expect(signal).toBeDefined()
    })

    expect(signal!.aborted).toBe(false)
    expect(peer.send).not.toHaveBeenCalled()

    await handler.close(peer as any)
    releaseProcedure!()

    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true)
    })

    expect(peer.send).not.toHaveBeenCalled()
  })

  describe('per-connection resource limits', () => {
    const toMessage = (rawData: string | Uint8Array<ArrayBuffer>) => ({
      rawData,
      uint8Array: () => typeof rawData === 'string' ? new TextEncoder().encode(rawData) : rawData,
    })
    const sent = (peer: { send: { mock: { calls: any[][] } } }) =>
      peer.send.mock.calls.map(([data]) => (decodePeerMessage(data) as any).message)
    const streamRequest = toMessage(JSON.stringify({ id: '1', kind: 'request', json: { url: '/stream', body: { json: null } } }))

    const createLiveHandler = (options: ConstructorParameters<typeof RPCHandler>[1] = {}) => new RPCHandler({
      live: os.handler(async function* ({ signal }) {
        await new Promise(resolve => signal?.addEventListener('abort', resolve))
      }),
    }, options)

    it('rejects requests above `maxConcurrentRequests`', async () => {
      const handler = createLiveHandler({ maxConcurrentRequests: 1 })
      const peer = createPeer()
      void handler.message(peer, toMessage(JSON.stringify({ id: '1', kind: 'request', json: { url: '/live' } })))
      void handler.message(peer, toMessage(JSON.stringify({ id: '2', kind: 'request', json: { url: '/live' } })))
      await vi.waitFor(() => expect(sent(peer).map(m => [m.id, m.json?.status])).toEqual([['2', 429], ['1', undefined]]))
      await handler.close(peer)
    })

    it('cancels streamed input exceeding `maxBufferedStreamSize`', async () => {
      const handler = createLiveHandler({ maxBufferedStreamSize: 1024 * 1024 })
      const peer = createPeer()
      void handler.message(peer, toMessage(JSON.stringify({ id: '1', kind: 'request', json: { url: '/live', headers: { 'standard-server': 'event-stream' } } })))
      await tick()
      const frame = toMessage(JSON.stringify({ id: '1', kind: 'event-stream', json: { data: { json: 'A'.repeat(16 * 1024) } } }))
      for (let i = 0; i < 256; i++) await handler.message(peer, frame)
      await vi.waitFor(() => expect(sent(peer).some(m => m.id === '1' && m.kind === 'stream/cancel')).toBe(true))
      await handler.close(peer)
    })

    it('never waits for a peer without `bufferedAmount` and `waitForDrain`', async () => {
      const handler = new RPCHandler({
        stream: os.handler(async function* () {
          yield 'x'
        }),
      })
      const peer = { ...createPeer(), bufferedAmount: Number.MAX_SAFE_INTEGER }
      await handler.message(peer, streamRequest)
      expect(sent(peer).map(m => m.kind)).toEqual(['response', 'event-stream', 'event-stream'])
    })

    it('waits with `waitForDrain` and stops waiting when the handler closes the connection', async () => {
      let produced = 0
      let finished = false
      const handler = new RPCHandler({
        stream: os.handler(async function* () {
          try {
            while (true) {
              produced++
              yield 'x'.repeat(200)
            }
          }
          finally { finished = true }
        }),
      }, { sendHighWaterMark: 50 })
      let signal: AbortSignal | undefined
      const peer = {
        bufferedAmount: 0,
        websocket: { readyState: 1 },
        send: vi.fn((data: string | Uint8Array) => {
          peer.bufferedAmount += data.length
        }),
        waitForDrain: vi.fn((options: { threshold?: number, signal?: AbortSignal }) => {
          signal = options.signal
          return new Promise<void>((_, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason)))
        }),
      }
      const result = handler.message(peer, streamRequest)
      await tick(50)
      expect(produced).toBe(1)
      expect(peer.send).toHaveBeenCalledTimes(1) // the response, then the first event waits
      expect(peer.waitForDrain).toHaveBeenCalledTimes(1)
      expect(peer.waitForDrain).toHaveBeenCalledWith({ threshold: 50, signal: expect.any(AbortSignal) })

      await handler.close(peer)
      expect(signal?.aborted).toBe(true)
      await expect(result).resolves.toMatchObject({ matched: true })
      expect(finished).toBe(true)
      expect(peer.send).toHaveBeenCalledTimes(1)
    })

    it('sends once `waitForDrain` resolves and drops messages once the connection is closed', async () => {
      const handler = new RPCHandler({
        stream: os.handler(async function* () {
          yield 'x'
        }),
      })
      const peer = {
        ...createPeer(),
        bufferedAmount: 2 * 1024 * 1024,
        websocket: { readyState: 1 },
        waitForDrain: vi.fn(async () => {
          peer.bufferedAmount = 0
        }),
      }
      await handler.message(peer, streamRequest)
      expect(peer.waitForDrain).toHaveBeenCalledTimes(1)
      expect(sent(peer).map(m => m.kind)).toEqual(['response', 'event-stream', 'event-stream'])

      const closedPeer = { ...peer, send: vi.fn(), websocket: { readyState: 3 } }
      await handler.message(closedPeer, streamRequest)
      expect(closedPeer.send).not.toHaveBeenCalled()
    })

    it('applies send backpressure when the client stops reading', { timeout: 15000 }, async () => {
      const TOTAL = 64
      let produced = 0
      const handler = new RPCHandler({
        stream: os.handler(async function* () {
          for (let i = 0; i < TOTAL; i++) {
            produced++
            yield 'x'.repeat(1024 * 1024)
          }
        }),
      })
      let serverPeer: any
      const ws = crossws({
        hooks: {
          open(peer) { serverPeer = peer },
          message(peer, message) { handler.message(peer, message) },
          close(peer) { handler.close(peer) },
        },
      })
      const server = createServer()
      server.on('upgrade', (req, socket, head) => ws.handleUpgrade(req, socket, head))
      server.listen(0)
      await once(server, 'listening')
      const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`)
      try {
        await once(client, 'open')
        ;(client as any)._socket.pause()
        client.send(streamRequest.rawData)
        await tick(1000) // well under crossws' default 30 s idleTimeout
        expect(produced).toBeLessThan(TOTAL)
        expect(serverPeer.bufferedAmount).toBeLessThan(16 * 1024 * 1024)
      }
      finally {
        client.terminate()
        ws.closeAll?.()
        await new Promise(resolve => server.close(resolve))
      }
    })
  })
})
