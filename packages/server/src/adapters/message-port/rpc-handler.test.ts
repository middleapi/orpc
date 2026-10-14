import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
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

  const createPort = () => {
    const channel = new MessageChannel()
    const clientPort = channel.port1
    const serverPort = channel.port2

    return {
      clientPort,
      serverPort,
    }
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

    const { serverPort } = createPort()
    const message = await createRequestMessage({ url: '/api/ping' })

    const posted: unknown[] = []
    vi.spyOn(serverPort, 'postMessage').mockImplementation((message) => {
      posted.push(message)
    })

    const result = await handler.message(serverPort as any, message, {
      context: { userId: 'u_123' },
      prefix: '/api',
    })

    expect(result.matched).toBe(true)
    expect(posted).toHaveLength(1)

    const decoded = decodePeerMessage(posted[0] as any) as any

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
  ])('handles %s request', async (_type, createMessage) => {
    const handler = createHandler()
    const { serverPort } = createPort()
    const message = await createMessage()

    const posted: unknown[] = []
    vi.spyOn(serverPort, 'postMessage').mockImplementation((message) => {
      posted.push(message)
    })

    const result = await handler.message(serverPort as any, message)

    expect(result.matched).toBe(true)
    expect(posted).toHaveLength(1)

    const decoded = decodePeerMessage(posted[0] as any) as any

    expect(decoded.matched).toBe(true)
    expect(decoded.message.kind).toBe('response')
    expect(decoded.message.json.status).toBe(undefined)
  })

  it('can decode messages with prefix', async () => {
    const handler = createHandler({
      decodePeerMessage: { prefix: 'orpc:' },
    })

    const { serverPort } = createPort()
    const posted: unknown[] = []
    vi.spyOn(serverPort, 'postMessage').mockImplementation((message) => {
      posted.push(message)
    })

    const message = await createRequestMessage()

    const result = await handler.message(serverPort as any, message)

    expect(result).toEqual({ matched: false })
    expect(posted).toHaveLength(0)

    const prefixedMessage = await createRequestMessage({ prefix: 'orpc:' })

    const result2 = await handler.message(serverPort as any, prefixedMessage)

    expect(result2.matched).toBe(true)
    expect(posted).toHaveLength(1)
  })

  it('can encode messages with prefix', async () => {
    const handler = createHandler({
      encodePeerMessage: { prefix: 'orpc:' },
    })

    const { serverPort } = createPort()
    const posted: unknown[] = []
    vi.spyOn(serverPort, 'postMessage').mockImplementation((message) => {
      posted.push(message)
    })

    const message = await createRequestMessage()

    const result = await handler.message(serverPort as any, message)

    expect(result.matched).toBe(true)
    expect(posted).toHaveLength(1)

    const decoded = decodePeerMessage(posted[0] as any, { prefix: 'orpc:' }) as any

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

    const { serverPort } = createPort()
    const postMessage = vi.spyOn(serverPort, 'postMessage').mockImplementation(() => {
      // noop
    })

    const message = await createRequestMessage()
    void handler.message(serverPort as any, message)

    await vi.waitFor(() => {
      expect(signal).toBeDefined()
    })

    expect(signal!.aborted).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()

    await handler.close(serverPort as any)
    releaseProcedure!()

    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true)
    })

    expect(postMessage).not.toHaveBeenCalled()

    await handler.close(serverPort as any) // safe to invoke multiple times
  })

  it('can receive and send un-encoded messages with transfer option (structured clone)', async () => {
    const transferable = new Uint8Array([1, 2, 3]).buffer

    const transfer = vi.fn(async () => {
      return [transferable]
    })

    const handler = createHandler({
      experimental_transfer: transfer,
    })

    const { serverPort } = createPort()

    const postMessage = vi.spyOn(serverPort, 'postMessage').mockImplementation(() => {
      // noop
    })

    const result = await handler.message(serverPort as any, {
      id: '19',
      kind: 'request',
      json: {
        url: '/ping',
        body: { json: 'input' },
        headers: {},
        method: 'POST',
      },
    })

    expect(result.matched).toBe(true)
    expect(transfer).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'response' }), [transferable])
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
  })

  it('ignore invalid message format', async () => {
    const handler = createHandler()
    const { serverPort } = createPort()
    const result = await handler.message(serverPort as any, { invalid: true })
    expect(result.matched).toBe(false)
  })

  describe('per-connection resource limits', () => {
    const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
    const big = 'A'.repeat(2 * 1024 * 1024)

    const setup = (options: ConstructorParameters<typeof RPCHandler>[1] = {}) => {
      const handler = new RPCHandler({
        live: os.handler(async function* ({ signal }) {
          await new Promise(resolve => signal?.addEventListener('abort', resolve))
        }),
      }, options)

      const { serverPort } = createPort()
      const posted: unknown[] = []
      vi.spyOn(serverPort, 'postMessage').mockImplementation((message) => {
        posted.push(message)
      })

      const messages = () => posted.map(m => typeof m === 'string' || m instanceof Uint8Array ? (decodePeerMessage(m as any) as any).message : m)
      const cancelled = (id: string) => messages().some(m => m.id === id && m.kind === 'stream/cancel')

      return { handler, port: serverPort as any, messages, cancelled }
    }

    it('rejects requests above `maxConcurrentRequests`', async () => {
      const { handler, port, messages } = setup({ maxConcurrentRequests: 1 })
      void handler.message(port, await encodePeerMessage({ id: '1', kind: 'request', json: { url: '/live' } }))
      void handler.message(port, { id: '2', kind: 'request', json: { url: '/live' } })
      await vi.waitFor(() => expect(messages().map(m => [m.id, m.json?.status])).toEqual([['2', 429], ['1', undefined]]))
      await handler.close(port)
    })

    it('cancels encoded streamed input exceeding `maxBufferedStreamSize`', async () => {
      const { handler, port, cancelled } = setup({ maxBufferedStreamSize: 1024 * 1024 })
      void handler.message(port, await encodePeerMessage({ id: '1', kind: 'request', json: { url: '/live', headers: { 'content-type': 'application/octet-stream' } } }))
      await tick()
      const message = await encodePeerMessage({ id: '1', kind: 'octet-stream', json: {}, binary: new Uint8Array(64 * 1024) })
      for (let i = 0; i < 32; i++) await handler.message(port, message)
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))
      await handler.close(port)
    })

    it.each([
      ['string', () => ({ json: big })],
      ['`Map`', () => new Map([['key', big]])],
      ['`Set`', () => new Set([big])],
      ['typed array', () => new Uint8Array(big.length)],
      ['`ArrayBuffer`', () => new ArrayBuffer(big.length)],
      ['`Blob`', () => new Blob([big])],
      ['circular', () => {
        const data: Record<string, unknown> = {}
        data.self = data
        return data
      }],
    ])('estimates the size of raw-object stream messages: %s', async (_, createData) => {
      const { handler, port, cancelled } = setup({ maxBufferedStreamSize: 1024 * 1024 })
      void handler.message(port, { id: '1', kind: 'request', json: { url: '/live', headers: { 'standard-server': 'event-stream' } } })
      await tick()
      await handler.message(port, { id: '1', kind: 'event-stream', json: { data: createData() } })
      await vi.waitFor(() => expect(cancelled('1')).toBe(true))
      await handler.close(port)
    })

    it('estimates the size of raw-object binary stream messages', async () => {
      const { handler, port, cancelled } = setup({ maxBufferedStreamSize: 1024 * 1024 })
      void handler.message(port, { id: '1', kind: 'request', json: { url: '/live', headers: { 'content-type': 'application/octet-stream' } } })
      void handler.message(port, { id: '2', kind: 'request', json: { url: '/live', headers: { 'content-type': 'application/octet-stream' } } })
      await tick()
      await handler.message(port, { id: '1', kind: 'octet-stream', json: {}, binary: new Uint8Array(big.length) })
      await handler.message(port, { id: '2', kind: 'octet-stream', json: {}, binary: new Blob([big]) })
      await vi.waitFor(() => expect(cancelled('1') && cancelled('2')).toBe(true))
      await handler.close(port)
    })

    it('keeps small raw-object stream messages, including `bigint`', async () => {
      const { handler, port, cancelled } = setup({ maxBufferedStreamSize: 1024 * 1024 })
      void handler.message(port, { id: '1', kind: 'request', json: { url: '/live', headers: { 'standard-server': 'event-stream' } } })
      await tick()
      for (let i = 0; i < 100; i++) await handler.message(port, { id: '1', kind: 'event-stream', json: { data: { value: 10n ** 30n } } })
      await tick()
      expect(cancelled('1')).toBe(false)
      await handler.close(port)
    })

    it('restores the previous behavior with `Infinity`', async () => {
      const { handler, port, messages } = setup({ maxConcurrentRequests: Infinity, maxBufferedStreamSize: Infinity })
      for (let i = 0; i < 150; i++) void handler.message(port, { id: String(i), kind: 'request', json: { url: '/live' } })
      void handler.message(port, { id: 'stream', kind: 'request', json: { url: '/live', headers: { 'standard-server': 'event-stream' } } })
      await tick()
      for (let i = 0; i < 16; i++) await handler.message(port, { id: 'stream', kind: 'event-stream', json: { data: big } })
      await vi.waitFor(() => expect(messages()).toHaveLength(151))
      expect(messages().some(m => m.kind === 'stream/cancel' || m.json?.status === 429)).toBe(false)
      await handler.close(port)
    })
  })
})
