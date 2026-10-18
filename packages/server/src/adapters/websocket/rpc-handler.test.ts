import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
import WebSocket, { WebSocketServer } from 'ws'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

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

  const createWs = () => ({
    addEventListener: vi.fn(),
    send: vi.fn(() => undefined),
  })

  const createRequestMessage = async ({
    prefix,
    url = '/ping',
  }: { prefix?: string, url?: `/${string}` } = {}) => {
    return encodePeerMessage({
      id: '19',
      kind: 'request',
      json: {
        url,
        body: { json: 'input' },
        headers: {},
        method: 'POST',
      },
    }, prefix ? { prefix } : undefined)
  }

  it('accepts context and prefix option in message method', async () => {
    const handler = new RPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const ws = createWs()
    const request = await createRequestMessage({ url: '/api/ping' })

    const result = await handler.message(ws as any, request, {
      context: { userId: 'u_123' },
      prefix: '/api',
    })

    expect(result.matched).toBe(true)
    expect(ws.send).toHaveBeenCalledTimes(1)

    const decoded = decodePeerMessage((ws as any).send.mock.calls[0][0]) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
    expect(decoded.message.json.body).toEqual({ json: 'u_123' })
  })

  it.each([
    ['string', () => createRequestMessage()],
    ['bytes', async () => {
      const message = await createRequestMessage()
      return new TextEncoder().encode(message as string)
    }],
    ['arrayBuffer', async () => {
      const message = await createRequestMessage()
      return new TextEncoder().encode(message as string).buffer
    }],
    ['arrayBuffer parts', async () => {
      const message = await createRequestMessage()
      return [new TextEncoder().encode(message as string).buffer]
    }],
  ])('handles %s request', async (_type, createMessage) => {
    const handler = createHandler()
    const ws = createWs()
    const request = await createMessage()

    const result = await handler.message(ws as any, request)

    expect(result.matched).toBe(true)
    expect(ws.send).toHaveBeenCalledTimes(1)

    const decoded = decodePeerMessage((ws as any).send.mock.calls[0][0]) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
  })

  it('can decode messages with prefix', async () => {
    const handler = createHandler({
      decodePeerMessage: { prefix: 'orpc:' },
    })

    const ws = createWs()
    const request = await createRequestMessage()

    const result = await handler.message(ws as any, request)

    expect(result).toEqual({ matched: false })
    expect(ws.send).not.toHaveBeenCalled()

    const prefixedRequest = await createRequestMessage({ prefix: 'orpc:' })

    const result2 = await handler.message(ws as any, prefixedRequest)

    expect(result2.matched).toBe(true)
    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('can encode messages with prefix', async () => {
    const handler = createHandler({
      encodePeerMessage: { prefix: 'orpc:' },
    })

    const ws = createWs()
    const request = await createRequestMessage()

    const result = await handler.message(ws as any, request)

    expect(result.matched).toBe(true)
    expect(ws.send).toHaveBeenCalledTimes(1)

    const decoded = decodePeerMessage((ws as any).send.mock.calls[0][0], { prefix: 'orpc:' }) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
  })

  it('wires message and close events via upgrade', async () => {
    let onMessage: ((event: { data: string }) => void) | undefined
    let onClose: (() => void) | undefined
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

    const ws = {
      addEventListener: vi.fn((event: string, callback: any) => {
        if (event === 'message') {
          onMessage = callback
        }

        if (event === 'close') {
          onClose = callback
        }
      }),
      send: vi.fn(() => undefined),
    }

    handler.upgrade(ws as any)

    const request = await createRequestMessage()
    onMessage?.({ data: request as string })

    await vi.waitFor(() => {
      expect(signal).toBeDefined()
    })

    expect(ws.send).not.toHaveBeenCalled()

    onClose?.()
    releaseProcedure!()

    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true)
    })

    expect(ws.send).not.toHaveBeenCalled()

    onClose?.() // safely call again to ensure no error is thrown
  })

  it('closes the connection instead of crashing on malformed ws frames via upgrade', async () => {
    const handler = createHandler()

    const wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => handler.upgrade(ws))
    onTestFinished(() => wss.close())

    const client = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`)
    await once(client, 'open')

    // `ws` rejects text frames carrying invalid UTF-8 by emitting `error` on the server socket
    client.send(new Uint8Array([0xFF]), { binary: false })

    const [code] = await once(client, 'close')
    expect(code).toBe(1007)
  })

  it('handles Blob messages via upgrade', async () => {
    let onMessage: ((event: { data: Blob }) => void) | undefined

    const handler = createHandler()

    const ws = {
      addEventListener: vi.fn((event: string, callback: any) => {
        if (event === 'message') {
          onMessage = callback
        }
      }),
      send: vi.fn(() => undefined),
    }

    handler.upgrade(ws as any)

    const request = await createRequestMessage()
    onMessage?.({ data: new Blob([request as string]) })

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    const decoded = decodePeerMessage((ws as any).send.mock.calls[0][0]) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
  })

  describe('keep-alive', () => {
    it.each([
      ['string', 'ping'],
      ['bytes', new TextEncoder().encode('ping')],
      ['arrayBuffer', new TextEncoder().encode('ping').buffer],
    ])('answers %s pings with a pong outside the peer protocol', async (_type, ping) => {
      const handler = createHandler()
      const ws = createWs()

      const result = await handler.message(ws as any, ping)

      expect(result).toEqual({ matched: true })
      expect(ws.send).toHaveBeenCalledTimes(1)
      expect(ws.send).toHaveBeenCalledWith('pong')
    })

    it('uses the peer message prefixes for pings and pongs', async () => {
      const handler = createHandler({
        decodePeerMessage: { prefix: 'in:' },
        encodePeerMessage: { prefix: 'out:' },
      })
      const ws = createWs()

      await expect(handler.message(ws as any, 'ping')).resolves.toEqual({ matched: false })
      expect(ws.send).not.toHaveBeenCalled()

      await expect(handler.message(ws as any, 'in:ping')).resolves.toEqual({ matched: true })
      expect(ws.send).toHaveBeenCalledWith('out:pong')
    })

    it('answers pings from a real client via upgrade', async () => {
      const handler = createHandler()

      const wss = new WebSocketServer({ port: 0 })
      wss.on('connection', ws => handler.upgrade(ws))
      onTestFinished(() => wss.close())

      const client = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`)
      onTestFinished(() => client.terminate())
      await once(client, 'open')

      client.send('ping')

      const [data, isBinary] = await once(client, 'message')
      expect(isBinary).toBe(false)
      expect(data.toString()).toBe('pong')
    })
  })

  describe('idleTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const createUpgradableWs = () => {
      const listeners: Record<string, (event?: any) => void> = {}

      return {
        addEventListener: vi.fn((event: string, callback: any) => {
          listeners[event] = callback
        }),
        removeEventListener: vi.fn(),
        send: vi.fn(() => undefined),
        close: vi.fn(),
        receive: (data: string) => listeners.message?.({ data }),
        emitClose: () => listeners.close?.(),
      }
    }

    it('is disabled by default', async () => {
      const ws = createUpgradableWs()
      createHandler().upgrade(ws)

      await vi.advanceTimersByTimeAsync(3_600_000)

      expect(ws.close).not.toHaveBeenCalled()
    })

    it('closes sockets that stay silent after upgrade with 1001', async () => {
      const ws = createUpgradableWs()
      createHandler({ idleTimeout: 1_000 }).upgrade(ws)

      await vi.advanceTimersByTimeAsync(999)
      expect(ws.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(ws.close).toHaveBeenCalledTimes(1)
      expect(ws.close).toHaveBeenCalledWith(1001, 'Idle timeout')
    })

    it.each([
      ['ping', 'ping'],
      ['request', '{"id":"1","kind":"request","json":{"url":"/ping"}}'],
      ['unmatched message', 'not-a-peer-message'],
    ])('resets the timer on any incoming message (%s)', async (_type, data) => {
      const ws = createUpgradableWs()
      createHandler({ idleTimeout: 1_000 }).upgrade(ws)

      await vi.advanceTimersByTimeAsync(900)
      ws.receive(data)
      await vi.advanceTimersByTimeAsync(900)
      expect(ws.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(100)
      expect(ws.close).toHaveBeenCalledTimes(1)
    })

    it('does not reset the timer on outgoing messages', async () => {
      let signal: AbortSignal | undefined
      const handler = new RPCHandler({
        stream: os.handler(async function* ({ signal: procedureSignal }) {
          signal = procedureSignal
          while (true) {
            yield 'event'
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }),
      }, { idleTimeout: 1_000 })

      const ws = createUpgradableWs()
      handler.upgrade(ws)
      ws.receive(await createRequestMessage({ url: '/stream' }) as string)

      await vi.advanceTimersByTimeAsync(999)
      expect(ws.send.mock.calls.length).toBeGreaterThan(5)
      expect(ws.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(ws.close).toHaveBeenCalledWith(1001, 'Idle timeout')
      // released immediately, without waiting for the close handshake of a possibly dead peer
      expect(signal?.aborted).toBe(true)
    })

    it('stops the timer once the socket closes', async () => {
      const ws = createUpgradableWs()
      createHandler({ idleTimeout: 1_000 }).upgrade(ws)

      ws.emitClose()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(ws.close).not.toHaveBeenCalled()
    })

    it('starts the timer on the first message when not using upgrade', async () => {
      const handler = createHandler({ idleTimeout: 1_000 })
      const ws = { send: vi.fn(), close: vi.fn() }

      await handler.message(ws, 'ping')
      await vi.advanceTimersByTimeAsync(999)
      await handler.message(ws, 'ping')
      await vi.advanceTimersByTimeAsync(999)
      expect(ws.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(ws.close).toHaveBeenCalledWith(1001, 'Idle timeout')

      await handler.close(ws)
    })
  })

  it('closes idle connections of a real client with 1001', async () => {
    const handler = createHandler({ idleTimeout: 50 })

    const wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => handler.upgrade(ws))
    onTestFinished(() => wss.close())

    const client = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`)
    await once(client, 'open')

    const [code, reason] = await once(client, 'close')
    expect(code).toBe(1001)
    expect(reason.toString()).toBe('Idle timeout')
  })
})
