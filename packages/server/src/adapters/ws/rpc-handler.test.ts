import { encodeRequestMessage, MessageType } from '@orpc/standard-server-peer'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

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

  let onMessage: any
  let onClose: any

  const wss = {
    addEventListener: vi.fn((event, callback) => {
      if (event === 'message')
        onMessage = callback
      if (event === 'close')
        onClose = callback
    }),
    send: vi.fn(),
  }

  handler.upgrade(wss)

  const string_request_message = {
    data: await encodeRequestMessage('19', MessageType.REQUEST, {
      url: new URL('http://orpc/ping'),
      body: { json: 'input' },
      headers: {},
      method: 'POST',
    }) as string,
  }

  const buffer_request_message = {
    data: [new TextEncoder().encode(string_request_message.data)],
  }

  it('works with string event', async () => {
    onMessage(string_request_message)

    await vi.waitFor(() => expect(wss.send).toHaveBeenCalledTimes(1))
  })

  it('work with buffer[] event', async () => {
    onMessage(buffer_request_message)

    await vi.waitFor(() => expect(wss.send).toHaveBeenCalledTimes(1))
  })

  it('abort on close', async () => {
    onMessage(string_request_message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signal.aborted).toBe(false)
    expect(wss.send).not.toHaveBeenCalled()

    onClose()
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    expect(wss.send).not.toHaveBeenCalled()
  })
})
