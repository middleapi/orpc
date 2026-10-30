import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { createORPCClient, ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { AbortError, promiseWithResolvers } from '@orpc/shared'
import WebSocket, { WebSocketServer } from 'ws'
import { getJsonRpcCall } from '../standard'
import { OpenRPCHandler } from './openrpc-handler'
import { OpenRPCLink } from './openrpc-link'

describe('openRPCHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createHandler = (options: ConstructorParameters<typeof OpenRPCHandler>[1] = {}) => {
    return new OpenRPCHandler({
      ping: os.handler(() => 'pong'),
      echo: os.$context<{ userId?: string }>().handler(({ context }) => context.userId),
    }, options)
  }

  const createWs = () => ({
    send: vi.fn((_data: string | Uint8Array<ArrayBuffer>) => undefined),
  })

  const getSentMessages = (ws: ReturnType<typeof createWs>) => ws.send.mock.calls.map(([data]) => JSON.parse(data as string))

  const call = (method: string, id?: string | number) => ({ jsonrpc: '2.0', method, id })

  const request = JSON.stringify(call('ping', 1))

  it('accepts context and prefix options in message method', async () => {
    const interceptor = vi.fn(({ next }) => next())
    const handler = createHandler({ interceptors: [interceptor] })
    const ws = createWs()

    const result = await handler.message(ws, JSON.stringify(call('echo', 1)), {
      context: { userId: 'u_123' },
      prefix: '/api',
    })

    expect(result).toEqual({ matched: true })
    expect(getSentMessages(ws)).toEqual([{ jsonrpc: '2.0', id: 1, result: 'u_123' }])
    expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({ prefix: '/api', request: expect.objectContaining({ url: '/api/echo' }) }))
  })

  it.each([
    ['string', () => request],
    ['bytes', () => new TextEncoder().encode(request)],
    ['arrayBuffer', () => new TextEncoder().encode(request).buffer],
    ['arrayBuffer parts', () => [new TextEncoder().encode(request).buffer]],
  ])('handles %s request', async (_type, createMessage) => {
    const handler = createHandler()
    const ws = createWs()

    await expect(handler.message(ws, createMessage())).resolves.toEqual({ matched: true })
    expect(getSentMessages(ws)).toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong' }])
  })

  it('reads the message before the buffer is detached, like uWebSockets does once the listener returns', async () => {
    const handler = createHandler()
    const ws = createWs()
    const buffer = new TextEncoder().encode(request).buffer

    const result = handler.message(ws, buffer, {
      context: async () => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return {}
      },
    })
    structuredClone(buffer, { transfer: [buffer] })

    await expect(result).resolves.toEqual({ matched: true })
    expect(getSentMessages(ws)).toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong' }])
  })

  it('answers a batch with one message, and notifications with none', async () => {
    const handler = createHandler()
    const ws = createWs()
    const notification = call('ping')

    await handler.message(ws, JSON.stringify([call('ping', 1), notification, call('ping', 'b')]))
    await handler.message(ws, JSON.stringify(notification))
    await handler.message(ws, JSON.stringify([notification, notification]))

    expect(getSentMessages(ws)).toEqual([[
      { jsonrpc: '2.0', id: 1, result: 'pong' },
      { jsonrpc: '2.0', id: 'b', result: 'pong' },
    ]])
  })

  it('answers unparsable messages with a parse error', async () => {
    const handler = createHandler()
    const ws = createWs()

    await handler.message(ws, '{"jsonrpc":')

    expect(getSentMessages(ws)).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }])
  })

  it('passes the handler options through', async () => {
    const handler = createHandler({ filter: (_, path) => path[0] !== 'echo', maxBatchSize: 1 })
    const ws = createWs()

    await handler.message(ws, JSON.stringify(call('echo', 1)))
    await handler.message(ws, JSON.stringify([call('ping', 1), call('ping', 2)]))

    expect(getSentMessages(ws)).toMatchObject([
      { id: 1, error: { code: -32601 } },
      // a WebSocket client matches responses by id, so each call of a refused message is answered
      [{ id: 1, error: { code: -32013, data: { code: 'PAYLOAD_TOO_LARGE' } } }, { id: 2, error: { code: -32013 } }],
    ])
  })

  it('runs routing interceptors once per message, and the other interceptors once per call', async () => {
    const routingInterceptor = vi.fn(({ next }) => next())
    const interceptor = vi.fn(({ next }) => next())
    const pluginInterceptor = vi.fn(({ next }) => next())
    const plugin: StandardHandlerPlugin<any> = {
      name: 'test',
      init: options => ({ ...options, interceptors: [...options.interceptors ?? [], pluginInterceptor] }),
    }
    const handler = createHandler({ routingInterceptors: [routingInterceptor], interceptors: [interceptor], plugins: [plugin] })

    await handler.message(createWs(), JSON.stringify([call('ping', 1), call('echo')]), { prefix: '/api' })

    expect(routingInterceptor).toHaveBeenCalledOnce()
    expect(routingInterceptor).toHaveBeenCalledWith(expect.objectContaining({ prefix: '/api', request: expect.objectContaining({ url: '/api', headers: {} }) }))

    for (const spy of [interceptor, pluginInterceptor]) {
      expect(spy.mock.calls.map(([{ request }]) => getJsonRpcCall(request))).toEqual([
        { method: 'ping', id: 1 },
        { method: 'echo', id: undefined },
      ])
    }
  })

  it('answers the errors of plugins that read the message, such as a size limit', async () => {
    const handler = createHandler({
      routingInterceptors: [({ next, ...options }) => next({
        ...options,
        request: {
          ...options.request,
          resolveBody: async () => {
            throw new ORPCError('PAYLOAD_TOO_LARGE')
          },
        },
      })],
    })
    const ws = createWs()

    await expect(handler.message(ws, request)).resolves.toEqual({ matched: true })
    expect(getSentMessages(ws)).toMatchObject([{ jsonrpc: '2.0', id: 1, error: { code: -32013, data: { code: 'PAYLOAD_TOO_LARGE' } } }])
  })

  it.each([
    // the error of the response status, or "Method not found"
    ['answered by a routing interceptor', { matched: true, response: { status: 401, headers: {}, body: undefined } }, -32001],
    ['declined by a routing interceptor', { matched: false }, -32601],
  ] as const)('answers each call of a message %s', async (_, result, code) => {
    const handler = createHandler({ routingInterceptors: [async () => result] })
    const ws = createWs()

    await handler.message(ws, JSON.stringify([call('ping', 1), call('ping'), call('ping', 'b')]))
    await handler.message(ws, JSON.stringify(call('ping')))
    await handler.message(ws, '[]')

    expect(getSentMessages(ws)).toMatchObject([
      [{ id: 1, error: { code } }, { id: 'b', error: { code } }],
      { id: null, error: { code } },
    ])
  })

  it('answers the calls of a refused message for the OpenRPC link', async () => {
    const handler = createHandler({
      routingInterceptors: [async ({ next, ...options }) => options.context.userId
        ? next()
        : { matched: true, response: { status: 401, headers: {}, body: undefined } }],
    })
    const wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => handler.upgrade(ws, { context: {} }))
    onTestFinished(() => wss.close())

    const client = createORPCClient<any>(new OpenRPCLink({ connect: () => new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`) }))

    await expect(client.ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('aborts the in-flight calls of a closed socket only', async () => {
    const signals: AbortSignal[] = []
    const release = promiseWithResolvers<void>()
    const handler = new OpenRPCHandler({
      ping: os.handler(async ({ signal }) => {
        signals.push(signal!)
        await release.promise
        signal?.throwIfAborted()
        return 'pong'
      }),
    })

    const closedWs = createWs()
    const openWs = createWs()
    const closedResult = handler.message(closedWs, request)
    const openResult = handler.message(openWs, request)

    await vi.waitFor(() => expect(signals).toHaveLength(2))

    handler.close(closedWs)
    handler.close(closedWs) // safely call again
    release.resolve()

    await expect(closedResult).resolves.toEqual({ matched: true })
    await expect(openResult).resolves.toEqual({ matched: true })
    expect(signals[0]!.reason).toEqual(new AbortError('WebSocket closed'))
    expect(signals[1]!.aborted).toBe(false)
    expect(closedWs.send).not.toHaveBeenCalled()
    expect(getSentMessages(openWs)).toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong' }])
  })

  it.each([
    ['string', (data: string) => data],
    ['Blob', (data: string) => new Blob([data])],
  ])('wires %s message, close, and error events via upgrade', async (_type, toData) => {
    const listeners = new Map<string, (event?: { data: unknown }) => void>()
    const ws = {
      addEventListener: vi.fn((event: string, listener: any) => listeners.set(event, listener)),
      send: vi.fn((_data: string | Uint8Array<ArrayBuffer>) => undefined),
    }
    const handler = createHandler()
    const close = vi.spyOn(handler, 'close')

    handler.upgrade(ws as any, { context: { userId: 'u_123' } })

    expect([...listeners.keys()]).toEqual(['message', 'close', 'error'])

    listeners.get('message')!({ data: toData(JSON.stringify(call('echo', 1))) })

    await vi.waitFor(() => expect(getSentMessages(ws)).toEqual([{ jsonrpc: '2.0', id: 1, result: 'u_123' }]))

    listeners.get('close')!()
    expect(close).toHaveBeenCalledWith(ws)
  })

  it('handles messages in arrival order via upgrade, even when a Blob loads first', async () => {
    const listeners = new Map<string, (event: { data: unknown }) => void>()
    const ws = {
      addEventListener: vi.fn((event: string, listener: any) => listeners.set(event, listener)),
      send: vi.fn((_data: string | Uint8Array<ArrayBuffer>) => undefined),
    }
    const handler = createHandler()
    const message = vi.spyOn(handler, 'message')

    handler.upgrade(ws as any)

    listeners.get('message')!({ data: new Blob([JSON.stringify(call('ping', 1))]) })
    listeners.get('message')!({ data: JSON.stringify(call('ping', 2)) })

    await vi.waitFor(() => expect(getSentMessages(ws)).toHaveLength(2))
    expect(message.mock.calls.map(([, data]) => data)).toEqual([expect.any(Uint8Array), JSON.stringify(call('ping', 2))])
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
})
