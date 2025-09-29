import { encodeRequestMessage, MessageType } from '@orpc/standard-server-peer'
import { os } from '../../builder'
import { experimental_RPCHandler as RPCHandler } from './rpc-handler'

describe('rpcHandler', async () => {
  let signal: AbortSignal

  beforeEach(() => {
    vi.clearAllMocks()
    signal = undefined as any
  })

  const handler = new RPCHandler({
    ping: os.handler(async ({ signal: _signal }) => {
      signal = _signal!
      await new Promise(resolve => setTimeout(resolve, 10))
      return 'pong'
    }),
  })

  const wss = {
    send: vi.fn(),
  }

  const ping_request_message = {
    rawData: await encodeRequestMessage('19', MessageType.REQUEST, {
      url: new URL('orpc://localhost/ping'),
      body: { json: 'input' },
      headers: {},
      method: 'POST',
    }) as string,
  } as any

  const ping_buffer_request_message = {
    rawData: new TextEncoder().encode(ping_request_message.rawData),
    uint8Array() {
      return this.rawData
    },
  } as any

  it('work with string event', async () => {
    handler.message(wss, ping_request_message)

    await vi.waitFor(() => expect(wss.send).toHaveBeenCalledTimes(1))
  })

  it('work with buffer event', async () => {
    handler.message(wss, ping_buffer_request_message)

    await vi.waitFor(() => expect(wss.send).toHaveBeenCalledTimes(1))
  })

  it('abort on close', async () => {
    handler.message(wss, ping_request_message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signal.aborted).toBe(false)
    expect(wss.send).not.toHaveBeenCalled()

    handler.close(wss)
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    expect(wss.send).not.toHaveBeenCalled()
  })
})
