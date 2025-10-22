import { MessageChannel } from 'node:worker_threads'
import { isObject } from '@orpc/shared'
import { decodeRequestMessage, deserializeRequestMessage, encodeResponseMessage, MessageType, serializeResponseMessage } from '@orpc/standard-server-peer'
import { createORPCClient } from '../../client'
import { RPCLink } from './rpc-link'

describe('rpcLink', () => {
  let orpc: any
  let receivedMessages: any[]
  let clientPort: any
  let serverPort: any
  let transfer: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const channel = new MessageChannel()
    clientPort = channel.port1
    serverPort = channel.port2

    clientPort.start()
    serverPort.start()

    receivedMessages = []
    serverPort.addEventListener('message', (event: any) => {
      receivedMessages.push(event.data)
    })

    transfer = vi.fn()
    orpc = createORPCClient(new RPCLink({
      port: clientPort,
      experimental_transfer: transfer,
    }))
  })

  it('on success', async () => {
    expect(orpc.ping('input')).resolves.toEqual('pong')

    await vi.waitFor(() => expect(receivedMessages.length).toBe(1))

    const [id, , payload] = (await decodeRequestMessage(receivedMessages[0]))

    expect(id).toBeTypeOf('string')
    expect(payload).toEqual({
      url: new URL('orpc://localhost/ping'),
      body: { json: 'input' },
      headers: {},
      method: 'POST',
    })

    serverPort.postMessage(
      await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }),
    )
  })

  it('on success with blob', async () => {
    expect(orpc.ping(new Blob(['input']))).resolves.toEqual('pong')

    await vi.waitFor(() => expect(receivedMessages.length).toBe(1))

    const [id, , payload] = (await decodeRequestMessage(receivedMessages[0]))

    expect(id).toBeTypeOf('string')
    expect(payload).toEqual({
      url: new URL('orpc://localhost/ping'),
      body: expect.any(FormData),
      headers: expect.any(Object),
      method: 'POST',
    })

    serverPort.postMessage(
      await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }),
    )
  })

  it('on success with transfer', async () => {
    const array = new Uint8Array([1, 2, 3])

    transfer.mockResolvedValueOnce([array.buffer])

    const promise = expect(orpc.ping(array)).resolves.toEqual('pong')

    await vi.waitFor(() => expect(receivedMessages.length).toBe(1))
    expect(receivedMessages[0]).toSatisfy(isObject)
    const [id, type, payload] = deserializeRequestMessage(receivedMessages[0])

    expect(array.byteLength).toBe(0) // transferred so length is 0

    expect(transfer).toHaveBeenCalledTimes(1)
    expect(transfer).toHaveBeenCalledWith([id, type, expect.objectContaining({
      url: new URL('orpc://localhost/ping'),
      body: { json: expect.toBeOneOf([array]) },
      headers: {},
      method: 'POST',
    })], expect.toBeOneOf([clientPort]))

    expect(id).toBeTypeOf('string')
    expect(payload).toEqual({
      url: new URL('orpc://localhost/ping'),
      body: { json: expect.toSatisfy(v => v !== array && v instanceof Uint8Array && v.byteLength === 3) },
      headers: {},
      method: 'POST',
    })

    serverPort.postMessage(
      serializeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }),
    )

    await promise
  })

  it('on close', async () => {
    expect(orpc.ping('input')).rejects.toThrow(/aborted/)

    await new Promise(resolve => setTimeout(resolve, 0))

    serverPort.close()
  })
})
