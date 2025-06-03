import { decodeResponseMessage, encodeRequestMessage, MessageType } from '@orpc/standard-server-peer'
import { os } from '../../builder'
import { experimental_RPCHandler as RPCHandler } from './rpc-handler'

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

      file: os.handler(async ({ signal: _signal }) => {
        signal = _signal!
        await new Promise(resolve => setTimeout(resolve, 10))
        return new Blob(['pong'])
      }),
    })

    handler.upgrade(serverPort)
  })

  const ping_request_message = await encodeRequestMessage(19, MessageType.REQUEST, {
    url: new URL('orpc:/ping'),
    body: { json: 'input' },
    headers: {},
    method: 'POST',
  })

  const file_request_message = new TextEncoder().encode(await encodeRequestMessage(19, MessageType.REQUEST, {
    url: new URL('orpc:/file'),
    body: { json: 'input' },
    headers: {},
    method: 'POST',
  }) as string)

  const not_found_request_message = await encodeRequestMessage(19, MessageType.REQUEST, {
    url: new URL('orpc:/not-found'),
    body: { json: 'input' },
    headers: {},
    method: 'POST',
  })

  const abort_message = await encodeRequestMessage(19, MessageType.ABORT_SIGNAL, undefined)

  it('on success', async () => {
    clientPort.postMessage(ping_request_message)

    await vi.waitFor(() => expect(sentMessages.length).toBe(1))

    const [id,, payload] = (await decodeResponseMessage(sentMessages[0]))

    expect(id).toBeTypeOf('number')
    expect(payload).toEqual({
      status: 200,
      headers: {},
      body: { json: 'pong' },
    })
  })

  it('on success with buffer data', async () => {
    clientPort.postMessage(file_request_message)

    await vi.waitFor(() => expect(sentMessages.length).toBe(1))

    const [id, , payload] = (await decodeResponseMessage(sentMessages[0]))

    expect(id).toBeTypeOf('number')
    expect(payload).toEqual({
      status: 200,
      headers: {
        'content-type': expect.any(String),
      },
      body: expect.any(FormData),
    })

    expect(await (payload as any).body.get('0').text()).toBe('pong')
  })

  it('on abort signal', { retry: 5 }, async () => {
    clientPort.postMessage(ping_request_message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signal?.aborted).toBe(false)
    expect(sentMessages).toHaveLength(0)

    clientPort.postMessage(abort_message)

    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    expect(sentMessages).toHaveLength(0)
  })

  it('on close', async () => {
    clientPort.postMessage(ping_request_message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signal?.aborted).toBe(false)
    expect(sentMessages).toHaveLength(0)

    clientPort.close()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    expect(sentMessages).toHaveLength(0)
  })

  it('on no procedure matched', async () => {
    clientPort.postMessage(not_found_request_message)

    await vi.waitFor(() => expect(sentMessages).toHaveLength(1))

    const [id,, payload] = (await decodeResponseMessage(sentMessages[0]))

    expect(id).toBeTypeOf('number')
    expect(payload).toEqual({
      status: 404,
      headers: {},
      body: 'No procedure matched',
    })
  })
})
