import type { AddressInfo } from 'node:net'
import { createORPCClient } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { AbortError, promiseWithResolvers } from '@orpc/shared'
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws'
import { OpenRPCLink } from './openrpc-link'

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

describe('openRPCLink', () => {
  const createWs = (readyState: 0 | 1 | 2 | 3 = WEBSOCKET_OPEN) => {
    const listeners = {
      open: new Set<() => void>(),
      message: new Set<(event: { data: unknown }) => Promise<void>>(),
      close: new Set<(event: { code: number, reason: string }) => void>(),
    }

    const websocket = {
      readyState: readyState as number,
      addEventListener: vi.fn((event: string, listener: any) => {
        listeners[event as keyof typeof listeners]?.add(listener)
      }),
      removeEventListener: vi.fn(),
      send: vi.fn((_data: string) => undefined),
      open() {
        websocket.readyState = WEBSOCKET_OPEN
        listeners.open.forEach(listener => listener())
      },
      async receive(data: unknown) {
        await Promise.all([...listeners.message].map(listener => listener({ data })))
      },
      close({ code = 1006, reason = '' } = {}) {
        websocket.readyState = WEBSOCKET_CLOSED
        listeners.close.forEach(listener => listener({ code, reason }))
      },
    }

    return websocket
  }

  const getSentRequest = (ws: ReturnType<typeof createWs>) => JSON.parse(ws.send.mock.calls[0]![0])
  const result = (id: number, value: unknown = 'pong') => ({ jsonrpc: '2.0', id, result: value })
  const respond = (ws: ReturnType<typeof createWs>, body: unknown) => ws.receive(JSON.stringify(body))

  it.each([
    ['string', (raw: string) => raw],
    ['bytes', (raw: string) => new TextEncoder().encode(raw)],
    ['Blob', (raw: string) => new Blob([raw])],
  ])('sends JSON-RPC requests and resolves %s responses', async (_type, toData) => {
    const ws = createWs()
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any

    const promise = orpc.planet.find({ id: 1 })

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    expect(getSentRequest(ws)).toEqual({ jsonrpc: '2.0', id: 1, method: 'planet.find', params: { id: 1 } })

    await ws.receive(toData(JSON.stringify(result(1))))
    await expect(promise).resolves.toBe('pong')
  })

  it('connects lazily on the first call and reuses the connection', async () => {
    const ws = createWs()
    const connect = vi.fn(() => ws)
    const orpc = createORPCClient(new OpenRPCLink({ connect })) as any

    expect(connect).not.toHaveBeenCalled()

    const first = orpc.ping('first')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    await respond(ws, result(1, 'pong-1'))
    await expect(first).resolves.toBe('pong-1')

    const second = orpc.ping('second')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2))
    await respond(ws, result(2, 'pong-2'))
    await expect(second).resolves.toBe('pong-2')

    expect(connect).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['separate messages', (responses: unknown[]) => responses],
    ['one batch message', (responses: unknown[]) => [responses]],
  ])('matches concurrent responses by id from %s', async (_type, toMessages) => {
    const ws = createWs()
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any

    const first = orpc.ping('first')
    const second = orpc.ping('second')

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2))

    for (const message of toMessages([result(2, 'pong-2'), result(1, 'pong-1')])) {
      await respond(ws, message)
    }

    await expect(first).resolves.toBe('pong-1')
    await expect(second).resolves.toBe('pong-2')
  })

  it('ignores unparsable messages and unknown ids', async () => {
    const ws = createWs()
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any

    const promise = orpc.ping('input')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))

    await ws.receive('not json')
    await respond(ws, result(999, 'unknown'))
    await respond(ws, [null, 'text', { jsonrpc: '2.0', result: 'no id' }])
    await respond(ws, result(1))

    await expect(promise).resolves.toBe('pong')
  })

  it('waits for a CONNECTING socket to open', async () => {
    const ws = createWs(WEBSOCKET_CONNECTING)
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any

    const promise = orpc.ping('input')

    await vi.waitFor(() => expect(ws.addEventListener).toHaveBeenCalledWith('open', expect.any(Function)))
    expect(ws.send).not.toHaveBeenCalled()

    ws.open()
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    await respond(ws, result(1))
    await expect(promise).resolves.toBe('pong')
  })

  it('rejects calls when the socket closes before opening', async () => {
    const ws = createWs(WEBSOCKET_CONNECTING)
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any

    const promise = orpc.ping('input')

    await vi.waitFor(() => expect(ws.addEventListener).toHaveBeenCalledWith('close', expect.any(Function)))
    ws.close()

    await expect(promise).rejects.toThrow(new AbortError('WebSocket closed (code 1006: )'))
    expect(ws.send).not.toHaveBeenCalled()
  })

  it.each([
    ['connect throws', () => Promise.reject(new Error('connect failed')), new Error('connect failed')],
    ['the socket is already closing', () => createWs(WEBSOCKET_CLOSING), new AbortError('WebSocket is already closing or closed')],
    ['the socket is already closed', () => createWs(WEBSOCKET_CLOSED), new AbortError('WebSocket is already closing or closed')],
  ])('rejects the call when %s, and connects again on the next call', async (_type, fail, error) => {
    const ws = createWs()
    const connect = vi.fn().mockImplementationOnce(fail).mockImplementationOnce(() => ws)
    const orpc = createORPCClient(new OpenRPCLink({ connect })) as any

    await expect(orpc.ping('first')).rejects.toThrow(error)

    const promise = orpc.ping('second')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    await respond(ws, result(2))

    await expect(promise).resolves.toBe('pong')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('rejects pending calls when the socket closes, and connects again on the next call', async () => {
    const firstWs = createWs()
    const secondWs = createWs()
    const connect = vi.fn().mockReturnValueOnce(firstWs).mockReturnValueOnce(secondWs)
    const orpc = createORPCClient(new OpenRPCLink({ connect })) as any

    const pending = orpc.ping('first')
    await vi.waitFor(() => expect(firstWs.send).toHaveBeenCalledTimes(1))
    firstWs.close({ code: 4001, reason: 'server restart' })

    await expect(pending).rejects.toThrow(new AbortError('WebSocket closed (code 4001: server restart)'))

    const promise = orpc.ping('second')
    await vi.waitFor(() => expect(secondWs.send).toHaveBeenCalledTimes(1))
    await respond(secondWs, result(2))

    await expect(promise).resolves.toBe('pong')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('aborts a call while the websocket connection is still being resolved', async () => {
    const ws = createWs()
    const connection = promiseWithResolvers<typeof ws>()
    const connect = vi.fn(() => connection.promise)
    const orpc = createORPCClient(new OpenRPCLink({ connect })) as any
    const controller = new AbortController()
    const reason = new Error('request aborted')

    const promise = orpc.ping('input', { signal: controller.signal })

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    controller.abort(reason)
    connection.resolve(ws)

    await expect(promise).rejects.toBe(reason)
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('rejects an aborted call client-side only, and ignores its late response', async () => {
    const ws = createWs()
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any
    const controller = new AbortController()
    const reason = new Error('request aborted')

    const aborted = orpc.ping('aborted', { signal: controller.signal })
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    controller.abort(reason)

    await expect(aborted).rejects.toBe(reason)
    expect(ws.send).toHaveBeenCalledTimes(1) // JSON-RPC has no cancel message

    const promise = orpc.ping('next')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2))
    await respond(ws, result(1, 'late'))
    await respond(ws, result(2, 'next'))

    await expect(promise).resolves.toBe('next')
  })

  it('rejects a call aborted at any moment before its response', async () => {
    const ws = createWs()
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any
    const reason = new Error('request aborted')

    // abort after a growing number of microtasks, so each step of the call is hit, the gap between awaits included
    for (let ticks = 0; ticks < 30; ticks++) {
      ws.send.mockClear()
      const controller = new AbortController()
      const assertion = expect(orpc.ping('input', { signal: controller.signal })).rejects.toBe(reason)

      for (let i = 0; i < ticks; i++) {
        await Promise.resolve()
      }

      controller.abort(reason)
      await new Promise(resolve => setTimeout(resolve))
      // a missed abort would resolve with this response instead of hanging
      await Promise.all(ws.send.mock.calls.map(([data]) => respond(ws, result(JSON.parse(data).id))))
      await assertion
    }
  })

  it('rejects a call whose send throws, and does not keep it pending', async ({ onTestFinished }) => {
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)
    onTestFinished(() => {
      process.off('unhandledRejection', unhandledRejection)
    })

    const ws = createWs()
    const error = new Error('send failed')
    ws.send.mockImplementationOnce(() => {
      throw error
    })
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws })) as any

    await expect(orpc.ping('input')).rejects.toBe(error)

    ws.close()
    await new Promise(resolve => setTimeout(resolve))
    expect(unhandledRejection).not.toHaveBeenCalled()
  })

  it('passes the serializer and standard link options', async () => {
    const ws = createWs()
    const serializer = new OpenAPIJsonSerializer()
    const serializeJson = vi.spyOn(serializer, 'serializeJson')
    const interceptor = vi.fn(({ next }) => next())
    const orpc = createORPCClient(new OpenRPCLink({ connect: () => ws, serializer, interceptors: [interceptor] })) as any

    const promise = orpc.ping('input')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1))
    await respond(ws, result(1))

    await expect(promise).resolves.toBe('pong')
    expect(serializeJson).toHaveBeenCalledWith('input')
    expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({ path: ['ping'], input: 'input' }))
  })

  // `ws` is EventEmitter-based, so an `error` event without a listener throws and crashes the process
  it('rejects calls instead of crashing when the connection is refused', async () => {
    const refused = new WebSocketServer({ port: 0 })
    const refusedUrl = `ws://localhost:${(refused.address() as AddressInfo).port}`
    await new Promise(resolve => refused.close(resolve))

    const orpc = createORPCClient(new OpenRPCLink({ connect: () => new WsWebSocket(refusedUrl) })) as any

    await expect(orpc.ping('input')).rejects.toThrow(new AbortError('WebSocket closed (code 1006: )'))
  })
})
