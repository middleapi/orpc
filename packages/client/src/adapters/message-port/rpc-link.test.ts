import { MessageChannel } from 'node:worker_threads'
import { decodeRequestMessage, encodeResponseMessage, MessageType } from '@orpc/standard-server-peer'
import { createORPCClient } from '../../client'
import { RPCLink } from './rpc-link'

describe('rpcLink', () => {
  let orpc: any
  let sentMessages: any[]
  let clientPort: any
  let serverPort: any

  beforeEach(() => {
    const channel = new MessageChannel()
    clientPort = channel.port1
    serverPort = channel.port2

    clientPort.start()
    serverPort.start()

    sentMessages = []
    serverPort.addEventListener('message', (event: any) => {
      sentMessages.push(event.data)
    })

    orpc = createORPCClient(new RPCLink({
      port: clientPort,
    }))
  })

  it('on success', async () => {
    expect(orpc.ping('input')).resolves.toEqual('pong')

    await vi.waitFor(() => expect(sentMessages.length).toBe(1))

    const [id, , payload] = (await decodeRequestMessage(sentMessages[0]))

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

    await vi.waitFor(() => expect(sentMessages.length).toBe(1))

    const [id, , payload] = (await decodeRequestMessage(sentMessages[0]))

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

  it('on close', async () => {
    expect(orpc.ping('input')).rejects.toThrow(/aborted/)

    await new Promise(resolve => setTimeout(resolve, 0))

    serverPort.close()
  })
})
