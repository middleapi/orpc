import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/websocket'
import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
import WebSocket, { WebSocketServer } from 'ws'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
const createWs = () => ({ send: vi.fn((_data: string | Uint8Array) => undefined) })
function sent(ws: ReturnType<typeof createWs>) {
  return ws.send.mock.calls.map(([data]) => (decodePeerMessage(data as any) as any).message)
}
function request(id: string, headers: Record<string, string> = {}) {
  return encodePeerMessage({ id, kind: 'request', json: { url: '/live', headers } })
}
function eventFrame(id: string, size: number) {
  return encodePeerMessage({ id, kind: 'event-stream', json: { data: { json: 'A'.repeat(size) } } })
}

function createRouter() {
  const state = { running: 0, received: 0, inputError: undefined as unknown }
  let release!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  const router = {
    // a typical public live feed with no `.input()`: runs until cancelled or the socket closes
    live: os.handler(async function* ({ input, signal }) {
      state.running++
      const aborted = new Promise(resolve => signal?.addEventListener('abort', resolve))
      try {
        await Promise.race([gate, aborted]) // a real subscription may never read `input`
        if (input && !signal?.aborted) {
          try {
            for await (const _ of input as AsyncIterable<unknown>) state.received++
          }
          catch (e) { state.inputError = e }
        }
        await aborted
      }
      finally { state.running-- }
    }),
  }
  return { router, state, release }
}

describe('peer adapters: per-connection resource limits', () => {
  it('caps concurrent in-flight requests per connection by default', async () => {
    const { router, state } = createRouter()
    const handler = new RPCHandler(router)
    const ws = createWs()
    for (let i = 0; i < 1000; i++) void handler.message(ws, await request(String(i)))
    await tick(100)
    expect(state.running).toBeLessThanOrEqual(100) // today: 1000
    await handler.close(ws)
    await vi.waitFor(() => expect(state.running).toBe(0))
  })

  it('rejects requests above `maxConcurrentRequests` and frees a slot when a call ends', async () => {
    const { router, state } = createRouter()
    const handler = new RPCHandler(router, { maxConcurrentRequests: 5 })
    const ws = createWs()
    const calls: Promise<unknown>[] = []
    for (let i = 0; i < 20; i++) calls.push(handler.message(ws, await request(String(i))))
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(20))
    expect(state.running).toBe(5) // today: 20
    expect(sent(ws).filter(m => m.kind === 'response' && m.json?.status === 429)).toHaveLength(15)

    await handler.message(ws, await encodePeerMessage({ id: '0', kind: 'cancel' }))
    await calls[0] // the slot is released once the call for id 0 has fully settled
    void handler.message(ws, await request('100'))
    await vi.waitFor(() => expect(state.running).toBe(5))
    await handler.close(ws)
  })

  it('cancels streamed input that exceeds `maxBufferedStreamSize` while unread', async () => {
    const { router, state, release } = createRouter()
    const handler = new RPCHandler(router, { maxBufferedStreamSize: 1024 * 1024 })
    const ws = createWs()
    void handler.message(ws, await request('1', { 'standard-server': 'event-stream' }))
    await tick()
    const frame = await eventFrame('1', 16 * 1024)
    for (let i = 0; i < 256; i++) await handler.message(ws, frame) // ~4 MiB, all unread
    release()
    await tick(50)
    expect(sent(ws).some(m => m.id === '1' && m.kind === 'stream/cancel')).toBe(true) // today: never sent
    expect(state.received).toBeLessThan(256) // today: 256, every frame was buffered
    expect(state.inputError).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    await handler.close(ws)
  })

  it('applies `maxBufferedStreamSize` across all calls of one connection', async () => {
    const { router } = createRouter()
    const handler = new RPCHandler(router, { maxBufferedStreamSize: 1024 * 1024 })
    const ws = createWs()
    for (let c = 0; c < 8; c++) {
      void handler.message(ws, await request(String(c), { 'standard-server': 'event-stream' }))
      await tick()
      for (let i = 0; i < 48; i++) await handler.message(ws, await eventFrame(String(c), 16 * 1024)) // 768 KiB per call
    }
    await tick(50)
    expect(sent(ws).some(m => m.kind === 'stream/cancel')).toBe(true) // today: 6 MiB buffered, no cancel
    await handler.close(ws)
  })

  it('bounds buffered streamed input by default', async () => {
    const { router } = createRouter()
    const handler = new RPCHandler(router)
    const ws = createWs()
    void handler.message(ws, await request('1', { 'content-type': 'application/octet-stream' }))
    await tick()
    const frame = await encodePeerMessage({ id: '1', kind: 'octet-stream', json: {}, binary: new Uint8Array(64 * 1024) }) as Uint8Array<ArrayBuffer>
    for (let i = 0; i < 512; i++) await handler.message(ws, frame.slice()) // 32 MiB, never read
    expect(sent(ws).some(m => m.id === '1' && m.kind === 'stream/cancel')).toBe(true) // today: never sent
    await handler.close(ws)
  })

  it('applies send backpressure when the client stops reading', { timeout: 15000 }, async () => {
    const TOTAL = 64
    let produced = 0
    const handler = new RPCHandler({
      stream: os.handler(async function* () {
        for (let i = 0; i < TOTAL; i++) {
          produced++
          yield 'x'.repeat(1024 * 1024) // 1 MiB
        }
      }),
    })
    const wss = new WebSocketServer({ port: 0 })
    let serverWs: WebSocket | undefined
    wss.on('connection', (ws) => {
      serverWs = ws
      handler.upgrade(ws)
    })
    await once(wss, 'listening')
    const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`)
    try {
      await once(client, 'open')
      ;(client as any)._socket.pause() // the client stops reading from its TCP socket
      client.send(JSON.stringify({ id: '1', kind: 'request', json: { url: '/stream', body: { json: null } } }))
      await tick(1000)
      expect(produced).toBeLessThan(TOTAL) // today: 64, the whole stream was pulled
      expect(serverWs!.bufferedAmount).toBeLessThan(16 * 1024 * 1024) // today: ~61 MiB
    }
    finally {
      client.terminate()
      await new Promise(resolve => wss.close(resolve))
    }
  })

  it('lets a procedure reading its input as fast as it arrives stream past `maxBufferedStreamSize`', async () => {
    const { router, state, release } = createRouter()
    const handler = new RPCHandler(router, { maxBufferedStreamSize: 1024 * 1024 })
    const ws = createWs()
    release()
    void handler.message(ws, await request('1', { 'standard-server': 'event-stream' }))
    await tick()
    const frame = await eventFrame('1', 16 * 1024)
    for (let i = 0; i < 256; i++) { // ~4 MiB in total
      await handler.message(ws, frame)
      await tick()
    }
    await vi.waitFor(() => expect(state.received).toBe(256))
    expect(sent(ws).some(m => m.kind === 'stream/cancel')).toBe(false)
    await handler.close(ws)
  })

  it('restores the previous behavior with `Infinity`', async () => {
    const { router, state } = createRouter()
    const handler = new RPCHandler(router, {
      maxConcurrentRequests: Infinity,
      maxBufferedStreamSize: Infinity,
      sendHighWaterMark: Infinity,
    })
    const ws = { ...createWs(), bufferedAmount: Number.MAX_SAFE_INTEGER }
    for (let i = 0; i < 150; i++) void handler.message(ws, await request(String(i)))
    void handler.message(ws, await request('stream', { 'standard-server': 'event-stream' }))
    await tick()
    const frame = await eventFrame('stream', 64 * 1024)
    for (let i = 0; i < 512; i++) await handler.message(ws, frame) // 32 MiB, never read
    await vi.waitFor(() => expect(state.running).toBe(151))
    expect(ws.send).toHaveBeenCalledTimes(151) // every response, despite the buffered amount
    expect(sent(ws).some(m => m.kind === 'stream/cancel' || m.json?.status === 429)).toBe(false)
    await handler.close(ws)
  })

  it('ignores a duplicate id sent while at the limit instead of answering it with a 429', async () => {
    const { router, state } = createRouter()
    const handler = new RPCHandler(router, { maxConcurrentRequests: 1 })
    const ws = createWs()
    void handler.message(ws, await request('1'))
    await vi.waitFor(() => expect(state.running).toBe(1))
    await handler.message(ws, await request('1'))
    await handler.message(ws, await request('2'))
    expect(sent(ws).map(m => [m.id, m.json?.status])).toEqual([['1', undefined], ['2', 429]])
    await handler.close(ws)
  })

  it('does not grow pending rejections beyond the limit for a client that does not read', async () => {
    const { router, state } = createRouter()
    const handler = new RPCHandler(router, { maxConcurrentRequests: 2 })
    const ws = { ...createWs(), bufferedAmount: 0 }
    for (let i = 0; i < 2; i++) void handler.message(ws, await request(String(i)))
    await vi.waitFor(() => expect(state.running).toBe(2))

    ws.bufferedAmount = 2 * 1024 * 1024 // the client stops reading
    for (let i = 2; i < 100; i++) {
      void handler.message(ws, await request(String(i)))
      await tick()
    }

    ws.bufferedAmount = 0
    await tick(100)
    expect(sent(ws).filter(m => m.json?.status === 429).map(m => m.id)).toEqual(['2', '3'])
    expect(state.running).toBe(2)
    await handler.close(ws)
  })

  it('bounds streamed input of a `GET` request, whose body is never read', async () => {
    const { router } = createRouter()
    const handler = new RPCHandler(router, { allowMethods: ['GET', 'POST'], maxBufferedStreamSize: 1024 * 1024 })
    const ws = createWs()
    void handler.message(ws, await encodePeerMessage({
      id: '1',
      kind: 'request',
      json: { method: 'GET', url: '/live', headers: { 'standard-server': 'event-stream' } },
    }))
    await tick()
    const frame = await eventFrame('1', 16 * 1024)
    for (let i = 0; i < 256; i++) await handler.message(ws, frame) // ~4 MiB
    await vi.waitFor(() => expect(sent(ws).some(m => m.id === '1' && m.kind === 'stream/cancel')).toBe(true))
    await handler.close(ws)
  })

  it('rejects calls above the limit with a typed `TOO_MANY_REQUESTS` error on the client', async () => {
    const { router } = createRouter()
    const handler = new RPCHandler({
      ...router,
      ping: os.handler(() => 'pong'),
    }, { maxConcurrentRequests: 1 })
    const wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => handler.upgrade(ws, { prefix: '/rpc' }))
    await once(wss, 'listening')
    const websocket = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`)
    const client = createORPCClient<any>(new RPCLink({ url: '/rpc', connect: () => websocket }))
    const controller = new AbortController()
    try {
      await client.live(undefined, { signal: controller.signal }) // holds the only slot
      await expect(client.ping()).rejects.toSatisfy(e => e instanceof ORPCError && e.code === 'TOO_MANY_REQUESTS')
      controller.abort()
      await vi.waitFor(() => expect(client.ping()).resolves.toBe('pong'))
    }
    finally {
      websocket.close()
      await new Promise(resolve => wss.close(resolve))
    }
  })

  it('ends a waiting send and its stream when the handler closes the connection', async () => {
    let produced = 0
    let finished = false
    const handler = new RPCHandler({
      stream: os.handler(async function* () {
        try {
          while (true) {
            produced++
            yield 'x'.repeat(1024)
          }
        }
        finally { finished = true }
      }),
    }, { sendHighWaterMark: 4096 })
    const buffer = { amount: 0 }
    const ws = {
      get bufferedAmount() { return buffer.amount },
      send: vi.fn((data: string | Uint8Array) => { buffer.amount += data.length }),
    }
    const result = handler.message(ws, JSON.stringify({ id: '1', kind: 'request', json: { url: '/stream', body: { json: null } } }))
    await tick(50)
    expect(produced).toBeLessThan(10)
    const sends = ws.send.mock.calls.length

    await handler.close(ws)
    await expect(result).resolves.toMatchObject({ matched: true })
    expect(finished).toBe(true)
    expect(ws.send).toHaveBeenCalledTimes(sends)
  })

  it('ends the stream when the client terminates while a send is waiting', { timeout: 15000 }, async () => {
    let finished = false
    const handler = new RPCHandler({
      stream: os.handler(async function* () {
        try {
          while (true) yield 'x'.repeat(1024 * 1024)
        }
        finally { finished = true }
      }),
    })
    const wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => handler.upgrade(ws))
    await once(wss, 'listening')
    const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`)
    try {
      await once(client, 'open')
      ;(client as any)._socket.pause()
      client.send(JSON.stringify({ id: '1', kind: 'request', json: { url: '/stream', body: { json: null } } }))
      await tick(500)
      expect(finished).toBe(false)
      client.terminate()
      await vi.waitFor(() => expect(finished).toBe(true))
    }
    finally {
      await new Promise(resolve => wss.close(resolve))
    }
  })

  describe('reads the buffered amount', () => {
    const streamRequest = JSON.stringify({ id: '1', kind: 'request', json: { url: '/stream', body: { json: null } } })
    const createStreamHandler = () => new RPCHandler({
      stream: os.handler(async function* () {
        yield 'x'
      }),
    })

    it('from `getBufferedAmount()`, as on Bun and uWebSockets.js', async () => {
      const handler = createStreamHandler()
      let amount = 2 * 1024 * 1024
      const ws = { ...createWs(), getBufferedAmount: () => amount }
      const result = handler.message(ws, streamRequest)
      await tick(50)
      expect(ws.send).not.toHaveBeenCalled()
      amount = 0
      await expect(result).resolves.toMatchObject({ matched: true })
      expect(sent(ws).map(m => m.kind)).toEqual(['response', 'event-stream', 'event-stream'])
    })

    it('and never waits when it is not exposed', async () => {
      const handler = createStreamHandler()
      const ws = createWs()
      await handler.message(ws, streamRequest)
      expect(sent(ws).map(m => m.kind)).toEqual(['response', 'event-stream', 'event-stream'])
    })

    it.each([
      ['`readyState` is above 1', { readyState: 3, bufferedAmount: 0 }],
      ['reading it throws, as on uWebSockets.js', { getBufferedAmount: () => { throw new Error('closed') } }],
    ])('and drops messages once the connection is closed: %s', async (_, closed) => {
      const handler = createStreamHandler()
      const ws = { ...createWs(), ...closed }
      await expect(handler.message(ws, streamRequest)).resolves.toMatchObject({ matched: true })
      expect(ws.send).not.toHaveBeenCalled()
    })
  })
})
