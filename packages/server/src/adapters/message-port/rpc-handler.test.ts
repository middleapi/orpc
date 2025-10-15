import { encodeMessagePortRequest, MessageType } from '@orpc/standard-server-peer'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rpcHandler', async () => {
  let signal: AbortSignal | undefined
  let serverPort: any
  let clientPort: any
  let sentMessages: any[]

  beforeEach(() => {
    signal = undefined
    const channel = new MessageChannel()
    clientPort = channel.port1
    serverPort = channel.port2

    sentMessages = []
    clientPort.addEventListener('message', (event: any) => {
      sentMessages.push(event.data)
    })

    const handler = new RPCHandler({
      ping: os.handler(async ({ signal: _signal }) => {
        signal = _signal!
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'pong'
      }),
    })

    handler.upgrade(serverPort)
  })

  const request_message = await encodeMessagePortRequest('19', MessageType.REQUEST, {
    url: new URL('orpc://localhost/ping'),
    body: { json: 'input' },
    headers: {},
    method: 'POST',
  })

  const buffer_request_message = await encodeMessagePortRequest('19', MessageType.REQUEST, {
    url: new URL('orpc://localhost/ping'),
    body: { json: new Uint8Array([1, 2, 3]) },
    headers: {},
    method: 'POST',
  })

  it('work with string event', async () => {
    clientPort.postMessage(request_message)
    await vi.waitFor(() => expect(sentMessages.length).toBe(1))
  })

  it('works with file/buffer data', async () => {
    clientPort.postMessage(buffer_request_message)
    await vi.waitFor(() => expect(sentMessages.length).toBe(1))
  })

  it('abort on close', { retry: 3 }, async () => {
    clientPort.postMessage(request_message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signal?.aborted).toBe(false)
    expect(sentMessages).toHaveLength(0)

    clientPort.close()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    expect(sentMessages).toHaveLength(0)
  })
})
