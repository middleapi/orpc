import { decodePeerMessage, encodePeerMessage } from '@standardserver/peer'
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
    expect(decoded.message.json.status).toBe(200)
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
    ['blob', async () => {
      const message = await createRequestMessage()
      return new Blob([message])
    }],
    ['blob parts', async () => {
      const message = await createRequestMessage()
      return [message]
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
    expect(decoded.message.json.status).toBe(200)
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
    expect(decoded.message.json.status).toBe(200)
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
})
