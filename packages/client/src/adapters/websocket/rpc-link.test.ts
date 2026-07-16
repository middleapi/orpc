import { promiseWithResolvers } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage } from '@standardserver/peer'
import { createORPCClient } from '../../client'
import { RPCLink } from './rpc-link'

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Some env maybe not available WebSocket global, like node 20
 */
const WEBSOCKET_CONNECTING = 0 satisfies WebSocket['CONNECTING']
const WEBSOCKET_OPEN = 1 satisfies WebSocket['OPEN']
const WEBSOCKET_CLOSING = 2 satisfies WebSocket['CLOSING']
const WEBSOCKET_CLOSED = 3 satisfies WebSocket['CLOSED']

describe('rpcLink', () => {
  const createWs = (readyState: 0 | 1 | 2 | 3 = WEBSOCKET_OPEN) => {
    const openListeners = new Set<() => void | Promise<void>>()
    const messageListeners = new Set<(event: { data: unknown }) => void | Promise<void>>()
    const closeListeners = new Set<(event: { code: number, reason: string }) => void | Promise<void>>()

    const websocket = {
      readyState: readyState as any,
      removeEventListener: vi.fn((event: string, callback: any) => {
        if (event === 'open') {
          openListeners.delete(callback)
          return
        }

        if (event === 'message') {
          messageListeners.delete(callback)
          return
        }

        if (event === 'close') {
          closeListeners.delete(callback)
          return
        }

        throw new Error(`${event} is not supported`)
      }),
      addEventListener: vi.fn((event: string, callback: any) => {
        if (event === 'open') {
          openListeners.add(callback)
          return
        }

        if (event === 'message') {
          messageListeners.add(callback)
          return
        }

        if (event === 'close') {
          closeListeners.add(callback)
          return
        }

        throw new Error(`${event} is not supported`)
      }),
      send: vi.fn(),
      async open() {
        websocket.readyState = WEBSOCKET_OPEN
        await Promise.all([...openListeners].map(listener => listener()))
      },
      async receive(data: unknown) {
        await Promise.all([...messageListeners].map(listener => listener({ data })))
      },
      async close(event: Partial<{ code: number, reason: string }> = {}) {
        websocket.readyState = WEBSOCKET_CLOSED

        await Promise.all([...closeListeners].map(listener => listener({
          code: event.code ?? 1006,
          reason: event.reason ?? '',
        })))
      },
    }

    return websocket
  }

  const createResponseMessage = async ({
    id,
    body = { json: 'pong' },
    status = 200,
    prefix,
  }: { id: string, body?: unknown, status?: number, prefix?: string }) => {
    return encodePeerMessage({
      id,
      kind: 'response',
      json: { body, status, headers: {} },
    }, prefix ? { prefix } : undefined)
  }

  const decodeRequest = (sent: any, prefix?: string) => {
    return decodePeerMessage(sent, prefix ? { prefix } : undefined) as {
      matched: true
      message: { id: string, kind: string, json: any }
    }
  }

  const getSentRequest = (ws: ReturnType<typeof createWs>, index = 0, prefix?: string) => {
    return decodeRequest(ws.send.mock.calls[index]![0], prefix)
  }

  it.each([
    ['string', async (encoded: string | Uint8Array<ArrayBuffer>) => encoded],
    ['blob', async (encoded: string | Uint8Array<ArrayBuffer>) => new Blob([encoded])],
  ])('sends RPC requests and resolves %s websocket responses', async (_type, transform) => {
    const ws = createWs()
    const orpc = createORPCClient(new RPCLink({ connect: () => ws })) as any

    const promise = orpc.ping('input')

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))

    const decoded = getSentRequest(ws)

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('request')
    expect(decoded.message.id).toBeTypeOf('string')
    expect(decoded.message.json).toEqual({
      url: '/ping',
      body: { json: 'input' },
    })

    const raw = await createResponseMessage({ id: decoded.message.id })
    await ws.receive(await transform(raw))

    await expect(promise).resolves.toEqual('pong')
  })

  it('connects eagerly on init and reuses that websocket for the first call', async () => {
    const ws = createWs(WEBSOCKET_CONNECTING)
    const connect = vi.fn(() => ws)
    const orpc = createORPCClient(new RPCLink({ connect, connectOnInit: true })) as any

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    expect(connect).toHaveBeenCalledWith({ totalAttempt: 1, attempt: 1 })

    const promise = orpc.ping('input')

    expect(ws.send).toHaveBeenCalledTimes(0)

    await ws.open()
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))

    const decoded = getSentRequest(ws)
    await ws.receive(await createResponseMessage({ id: decoded.message.id }))

    await expect(promise).resolves.toEqual('pong')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('connects eagerly on init ignore background error', async ({ onTestFinished }) => {
    const unhandledRejectionHandler = vi.fn()
    process.on('unhandledRejection', unhandledRejectionHandler)

    onTestFinished(() => {
      process.off('unhandledRejection', unhandledRejectionHandler)
    })

    const connect = vi.fn().mockRejectedValueOnce(new Error('TEST'))
    const orpc = createORPCClient(new RPCLink({ connect, connectOnInit: true })) as any

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    expect(connect).toHaveBeenCalledWith({ totalAttempt: 1, attempt: 1 })
    expect(unhandledRejectionHandler).toHaveBeenCalledTimes(0) // no background error
  })

  it('shares a single lazy websocket connection across concurrent requests', async () => {
    const ws = createWs(WEBSOCKET_CONNECTING)
    const connect = vi.fn(() => ws)
    const orpc = createORPCClient(new RPCLink({ connect })) as any

    const promise1 = orpc.ping('input-1')
    const promise2 = orpc.ping('input-2')

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    expect(ws.send).toHaveBeenCalledTimes(0)

    await ws.open()
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2))

    const firstRequest = getSentRequest(ws, 0)
    const secondRequest = getSentRequest(ws, 1)

    await ws.receive(await createResponseMessage({ id: firstRequest.message.id, body: { json: 'pong-1' } }))
    await ws.receive(await createResponseMessage({ id: secondRequest.message.id, body: { json: 'pong-2' } }))

    await expect(promise1).resolves.toEqual('pong-1')
    await expect(promise2).resolves.toEqual('pong-2')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('aborts a call while the websocket connection is still being resolved', async () => {
    const pendingSocket = createWs()
    const connection = promiseWithResolvers<typeof pendingSocket>()
    const connect = vi.fn(() => connection.promise)
    const orpc = createORPCClient(new RPCLink({ connect })) as any
    const controller = new AbortController()
    const reason = new Error('request aborted')

    const promise = orpc.ping('input', { signal: controller.signal })

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))

    controller.abort(reason)
    connection.resolve(pendingSocket)

    await expect(promise).rejects.toBe(reason)
    expect(pendingSocket.send).toHaveBeenCalledTimes(0)
  })

  it('aborts a call if signal was aborted before connect', async () => {
    const pendingSocket = createWs()
    const connection = promiseWithResolvers<typeof pendingSocket>()
    const connect = vi.fn(() => connection.promise)
    const orpc = createORPCClient(new RPCLink({ connect })) as any
    const controller = new AbortController()
    const reason = new Error('request aborted')
    controller.abort(reason)

    const promise = orpc.ping('input', { signal: controller.signal })

    await expect(promise).rejects.toBe(reason)
    expect(pendingSocket.send).toHaveBeenCalledTimes(0)
    expect(connect).toHaveBeenCalledTimes(0)
  })

  it('supports prefixed peer messages and ignores unrelated frames', async () => {
    const ws = createWs()
    const orpc = createORPCClient(new RPCLink({
      connect: () => ws,
      encodePeerMessage: { prefix: 'orpc:' },
      decodePeerMessage: { prefix: 'orpc:' },
    })) as any

    const promise = orpc.ping('input')

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))

    const decoded = getSentRequest(ws, 0, 'orpc:')

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('request')

    await ws.receive(await createResponseMessage({ id: decoded.message.id, prefix: 'wrong:' }))
    await ws.receive('not-a-peer-message')
    await ws.receive(await createResponseMessage({ id: decoded.message.id, prefix: 'orpc:' }))

    await expect(promise).resolves.toEqual('pong')
  })

  it('propagates connection failures when reconnect is disabled', async () => {
    const error = new Error('connect failed')
    const orpc = createORPCClient(new RPCLink({ connect: () => Promise.reject(error) })) as any

    await expect(orpc.ping('input')).rejects.toBe(error)
  })

  it('stops retrying after the configured reconnect attempts', async () => {
    const delay = vi.fn(() => 0)
    const connect = vi.fn(() => Promise.reject(new Error('temporary outage')))
    const orpc = createORPCClient(new RPCLink({
      connect,
      reconnect: {
        enabled: true,
        delay,
        maxAttempt: 1,
      },
    })) as any

    await expect(orpc.ping('input')).rejects.toThrow('WebSocket reconnect failed after 1 attempt(s)')
    expect(delay).toHaveBeenCalledWith({ totalAttempt: 1, attempt: 1 })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('uses the default reconnect backoff before retrying a transient connection failure', async ({ onTestFinished }) => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })

    const recoveredSocket = createWs()
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(recoveredSocket)
    const orpc = createORPCClient(new RPCLink({
      connect,
      reconnect: { enabled: true },
    })) as any

    const promise = orpc.ping('input')

    await vi.advanceTimersByTimeAsync(0)
    expect(connect).toHaveBeenNthCalledWith(1, { totalAttempt: 1, attempt: 1 })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(connect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(connect).toHaveBeenNthCalledWith(2, { totalAttempt: 2, attempt: 2 })
    expect(recoveredSocket.send).toHaveBeenCalledTimes(1)

    const request = getSentRequest(recoveredSocket)
    await recoveredSocket.receive(await createResponseMessage({ id: request.message.id, body: { json: 'recovered' } }))

    await expect(promise).resolves.toEqual('recovered')
  })

  it('reconnects on the next call after a socket closes', async () => {
    const firstSocket = createWs()
    const secondSocket = createWs()
    const connect = vi.fn()
      .mockImplementationOnce(() => firstSocket)
      .mockImplementationOnce(() => secondSocket)
    const orpc = createORPCClient(new RPCLink({
      connect,
      reconnect: { enabled: true },
    })) as any

    const firstCall = orpc.ping('first')

    await vi.waitFor(() => expect(firstSocket.send).toHaveBeenCalledTimes(1))
    const firstRequest = getSentRequest(firstSocket)
    await firstSocket.receive(await createResponseMessage({ id: firstRequest.message.id, body: { json: 'pong-1' } }))
    await expect(firstCall).resolves.toEqual('pong-1')

    await firstSocket.close({ code: 4001, reason: 'server restart' })

    const secondCall = orpc.ping('second')

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    expect(connect).toHaveBeenNthCalledWith(1, { totalAttempt: 1, attempt: 1 })
    expect(connect).toHaveBeenNthCalledWith(2, { totalAttempt: 2, attempt: 1 })
    await vi.waitFor(() => expect(secondSocket.send).toHaveBeenCalledTimes(1))

    const secondRequest = getSentRequest(secondSocket)
    await secondSocket.receive(await createResponseMessage({ id: secondRequest.message.id, body: { json: 'pong-2' } }))
    await expect(secondCall).resolves.toEqual('pong-2')
  })

  it('can proactively reconnect on close before the next call arrives', async () => {
    const firstSocket = createWs()
    const secondSocket = createWs()
    const connect = vi.fn()
      .mockImplementationOnce(() => firstSocket)
      .mockImplementationOnce(() => secondSocket)
    const orpc = createORPCClient(new RPCLink({
      connect,
      reconnect: {
        enabled: true,
        onClose: {
          enabled: true,
          delay: 0,
        },
      },
    })) as any

    const firstCall = orpc.ping('first')

    await vi.waitFor(() => expect(firstSocket.send).toHaveBeenCalledTimes(1))
    const firstRequest = getSentRequest(firstSocket)
    await firstSocket.receive(await createResponseMessage({ id: firstRequest.message.id }))
    await expect(firstCall).resolves.toEqual('pong')

    await firstSocket.close({ code: 1001, reason: 'going away' })

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))

    const secondCall = orpc.ping('second')

    await vi.waitFor(() => expect(secondSocket.send).toHaveBeenCalledTimes(1))
    const secondRequest = getSentRequest(secondSocket)
    await secondSocket.receive(await createResponseMessage({ id: secondRequest.message.id, body: { json: 'pong-2' } }))

    await expect(secondCall).resolves.toEqual('pong-2')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('reconnect on close before the next call arrives ignore background errors', async ({ onTestFinished }) => {
    const unhandledRejectionHandler = vi.fn()
    process.on('unhandledRejection', unhandledRejectionHandler)

    onTestFinished(() => {
      process.off('unhandledRejection', unhandledRejectionHandler)
    })

    const firstSocket = createWs()
    const connect = vi.fn()
      .mockImplementationOnce(() => firstSocket)
      .mockRejectedValueOnce(new Error('TEST'))

    const orpc = createORPCClient(new RPCLink({
      connect,
      reconnect: {
        enabled: true,
        maxAttempt: 1,
        onClose: {
          enabled: true,
          delay: 0,
        },
      },
    })) as any

    const firstCall = orpc.ping('first')

    await vi.waitFor(() => expect(firstSocket.send).toHaveBeenCalledTimes(1))
    const firstRequest = getSentRequest(firstSocket)
    await firstSocket.receive(await createResponseMessage({ id: firstRequest.message.id }))
    await expect(firstCall).resolves.toEqual('pong')

    await firstSocket.close({ code: 1001, reason: 'going away' })

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    expect(unhandledRejectionHandler).toHaveBeenCalledTimes(0) // no background error
  })
})
