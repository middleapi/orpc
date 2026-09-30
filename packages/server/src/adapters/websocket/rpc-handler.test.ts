import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { promiseWithResolvers } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
import WebSocket, { WebSocketServer } from 'ws'
import { os } from '../../builder'
import { RethrowHandlerPlugin } from '../../plugins'
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

  const listen = (onConnection: (ws: WebSocket) => void) => {
    const wss = new WebSocketServer({ port: 0 })
    wss.on('connection', onConnection)
    onTestFinished(() => {
      wss.clients.forEach(ws => ws.terminate())
      wss.close()
    })
    return `ws://localhost:${(wss.address() as AddressInfo).port}`
  }

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

  describe('errors via upgrade', () => {
    const error = new Error('Something went wrong')

    it.each([
      ['a throwing context function', () => ({
        handler: createHandler(),
        context: () => {
          throw error
        },
      })],
      ['an error rethrown by RethrowHandlerPlugin', () => ({
        handler: new RPCHandler({
          ping: os.handler(() => {
            throw error
          }),
        }, {
          plugins: [new RethrowHandlerPlugin({ filter: () => true })],
        }),
        context: {},
      })],
    ])('cancels the request instead of crashing on %s', async (_, setup) => {
      const { handler, context } = setup()
      const url = listen(ws => handler.upgrade(ws, { context }))

      const client = new WebSocket(url)
      await once(client, 'open')
      client.send(await createRequestMessage())

      const [data] = await once(client, 'message')
      expect(decodePeerMessage(data.toString())).toEqual({ matched: true, message: { id: '19', kind: 'cancel' } })
    })

    it('reports the error to onUnhandledError', async () => {
      const onUnhandledError = vi.fn()
      const handler = createHandler({ onUnhandledError })
      const url = listen(ws => handler.upgrade(ws, {
        context: () => {
          throw error
        },
      }))

      const client = new WebSocket(url)
      await once(client, 'open')
      client.send(await createRequestMessage())
      await once(client, 'message')

      expect(onUnhandledError).toHaveBeenCalledExactlyOnceWith(error)
    })
  })

  it('drops a Blob message that finishes loading after close via upgrade', async () => {
    const ping = vi.fn(() => 'pong')
    const handler = new RPCHandler({ ping: os.handler(ping) })

    // Hold the Blob read until the socket has closed
    const { promise: canLoad, resolve: allowLoad } = promiseWithResolvers<void>()
    const { bytes } = Blob.prototype
    let loading: ReturnType<Blob['bytes']> | undefined
    const bytesSpy = vi.spyOn(Blob.prototype, 'bytes').mockImplementation(function (this: Blob) {
      return loading = canLoad.then(() => bytes.call(this))
    })
    onTestFinished(() => bytesSpy.mockRestore())

    let serverWs: WebSocket | undefined
    const url = listen((ws) => {
      // @ts-expect-error `ws` supports 'blob' but its types do not list it yet
      ws.binaryType = 'blob'
      serverWs = ws
      handler.upgrade(ws)
    })

    const client = new WebSocket(url)
    await once(client, 'open')
    client.send(new TextEncoder().encode(await createRequestMessage() as string))

    await vi.waitFor(() => {
      expect(loading).toBeDefined()
    })

    const send = vi.spyOn(serverWs!, 'send')
    client.close()
    await once(serverWs!, 'close')

    allowLoad()
    await loading
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(ping).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
