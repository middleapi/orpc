import { decodePeerMessage, encodePeerMessage } from '@standard-server/peer'
import { os } from '../../builder'
import { experimental_RPCHandler as RPCHandler } from './rpc-handler'

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

  describe('keep-alive', () => {
    it.each([
      ['string', 'ping'],
      ['bytes', new TextEncoder().encode('ping')],
    ] as const)('answers %s pings with a pong outside the peer protocol', async (_type, rawData) => {
      const handler = createHandler()
      const peer = createPeer()

      const result = await handler.message(peer, await createMessage({ rawData }))

      expect(result).toEqual({ matched: true })
      expect(peer.send).toHaveBeenCalledTimes(1)
      expect(peer.send).toHaveBeenCalledWith('pong')
    })

    it('uses the peer message prefixes for pings and pongs', async () => {
      const handler = createHandler({
        decodePeerMessage: { prefix: 'in:' },
        encodePeerMessage: { prefix: 'out:' },
      })
      const peer = createPeer()

      await expect(handler.message(peer, await createMessage({ rawData: 'ping' }))).resolves.toEqual({ matched: false })
      expect(peer.send).not.toHaveBeenCalled()

      await expect(handler.message(peer, await createMessage({ rawData: 'in:ping' }))).resolves.toEqual({ matched: true })
      expect(peer.send).toHaveBeenCalledWith('out:pong')
    })
  })

  describe('idleTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const createClosablePeer = () => ({ send: vi.fn(() => undefined), close: vi.fn() })

    it('is disabled by default', async () => {
      const handler = createHandler()
      const peer = createClosablePeer()

      await handler.message(peer, await createMessage({ rawData: 'ping' }))
      await vi.advanceTimersByTimeAsync(3_600_000)

      expect(peer.close).not.toHaveBeenCalled()
    })

    it('closes peers with 1001 when no message arrives in time, and resets on any message', async () => {
      const handler = createHandler({ idleTimeout: 1_000 })
      const peer = createClosablePeer()

      await handler.message(peer, await createMessage({ rawData: 'ping' }))
      await vi.advanceTimersByTimeAsync(900)
      await handler.message(peer, await createMessage({ rawData: 'not-a-peer-message' }))
      await vi.advanceTimersByTimeAsync(999)
      expect(peer.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(peer.close).toHaveBeenCalledTimes(1)
      expect(peer.close).toHaveBeenCalledWith(1001, 'Idle timeout')
    })

    it('aborts in-flight requests when closing an idle peer', async () => {
      let signal: AbortSignal | undefined
      const handler = new RPCHandler({
        ping: os.handler(async ({ signal: procedureSignal }) => {
          signal = procedureSignal
          await new Promise(() => {})
        }),
      }, { idleTimeout: 1_000 })
      const peer = createClosablePeer()

      void handler.message(peer, await createMessage())
      await vi.advanceTimersByTimeAsync(1_000)

      expect(peer.close).toHaveBeenCalledWith(1001, 'Idle timeout')
      expect(signal?.aborted).toBe(true)
    })

    it('stops the timer once the peer closes', async () => {
      const handler = createHandler({ idleTimeout: 1_000 })
      const peer = createClosablePeer()

      await handler.message(peer, await createMessage({ rawData: 'ping' }))
      await handler.close(peer)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(peer.close).not.toHaveBeenCalled()
    })
  })
})
