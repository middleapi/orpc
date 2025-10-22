import { isObject, onError } from '@orpc/shared'
import { decodeRequestMessage, deserializeResponseMessage, encodeRequestMessage, MessageType, serializeRequestMessage } from '@orpc/standard-server-peer'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rpcHandler', async () => {
  let signal: AbortSignal | undefined
  let serverPort: any
  let clientPort: any
  let receivedMessages: any[]
  let transfer: ReturnType<typeof vi.fn>
  let handler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    signal = undefined
    const channel = new MessageChannel()
    clientPort = channel.port1
    serverPort = channel.port2

    receivedMessages = []
    clientPort.addEventListener('message', (event: any) => {
      receivedMessages.push(event.data)
    })

    transfer = vi.fn()
    handler = vi.fn(async ({ signal: _signal }) => {
      signal = _signal!
      await new Promise(resolve => setTimeout(resolve, 10))
      return 'pong'
    })

    const handlerClass = new RPCHandler({
      ping: os.handler(handler),
    }, {
      experimental_transfer: transfer,
      interceptors: [onError(e => console.error(e))],
    })

    handlerClass.upgrade(serverPort)
  })

  const string_request_message = await encodeRequestMessage('19', MessageType.REQUEST, {
    url: new URL('orpc://localhost/ping'),
    body: { json: 'input' },
    headers: {},
    method: 'POST',
  }) as string

  const buffer_request_message = new TextEncoder().encode(string_request_message)

  it('work with string event', async () => {
    clientPort.postMessage(string_request_message)
    await vi.waitFor(() => expect(receivedMessages.length).toBe(1))
  })

  it('works with file/buffer data', async () => {
    clientPort.postMessage(buffer_request_message)
    await vi.waitFor(() => expect(receivedMessages.length).toBe(1))
  })

  it('works with transfer', async () => {
    const array = new Uint8Array([1, 2, 3])
    transfer.mockResolvedValueOnce([array.buffer])
    handler.mockResolvedValueOnce(array)

    clientPort.postMessage(serializeRequestMessage(...await decodeRequestMessage(string_request_message) as [any, any, any]))
    await vi.waitFor(() => expect(receivedMessages.length).toBe(1))
    expect(receivedMessages[0]).toSatisfy(isObject)
    const [id, type, payload] = deserializeResponseMessage(receivedMessages[0])

    expect(array.byteLength).toBe(0) // transferred so length is 0

    expect(transfer).toHaveBeenCalledTimes(1)
    expect(transfer).toHaveBeenCalledWith([id, type, expect.objectContaining({
      body: { json: expect.toBeOneOf([array]) },
      headers: {},
    })], expect.toBeOneOf([serverPort]))

    expect(id).toBeTypeOf('string')
    expect(payload).toEqual({
      status: 200,
      body: { json: expect.toSatisfy(v => v !== array && v instanceof Uint8Array && v.byteLength === 3) },
      headers: {},
    })
  })

  it('abort on close', { retry: 3 }, async () => {
    clientPort.postMessage(string_request_message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signal?.aborted).toBe(false)
    expect(receivedMessages).toHaveLength(0)

    clientPort.close()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    expect(receivedMessages).toHaveLength(0)
  })
})
