import { decodeRequestMessage, encodeResponseMessage, MessageType } from '@orpc/standard-server-peer'
import { createORPCClient } from '../../client'
import { RPCLink } from './rpc-link'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rpcLink', () => {
  let onMessage: any
  let onClose: any

  const websocket = {
    readyState: 1,
    addEventListener: vi.fn((event, callback) => {
      if (event === 'message')
        onMessage = callback
      if (event === 'close')
        onClose = callback
    }),
    send: vi.fn(),
  }

  const link = new RPCLink({
    websocket,
  })

  const orpc = createORPCClient(link) as any

  it('on success', async () => {
    const promise = expect(orpc.ping('input')).resolves.toEqual('pong')

    await vi.waitFor(() => expect(websocket.send).toHaveBeenCalledTimes(1))

    const [id,, payload] = (await decodeRequestMessage(websocket.send.mock.calls[0]![0]))

    expect(id).toBeTypeOf('string')
    expect(payload).toEqual({
      url: new URL('orpc://localhost/ping'),
      body: { json: 'input' },
      headers: {},
      method: 'POST',
    })

    onMessage({ data: await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }) })

    await promise
  })

  it('on success - blob', async () => {
    const promise = expect(orpc.ping('input')).resolves.toEqual('pong')

    await vi.waitFor(() => expect(websocket.send).toHaveBeenCalledTimes(1))

    const [id, , payload] = (await decodeRequestMessage(websocket.send.mock.calls[0]![0]))

    expect(id).toBeTypeOf('string')
    expect(payload).toEqual({
      url: new URL('orpc://localhost/ping'),
      body: { json: 'input' },
      headers: {},
      method: 'POST',
    })

    onMessage({ data: new Blob([await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} })]) })

    await promise
  })

  it('on close', async () => {
    expect(orpc.ping('input')).rejects.toThrow(/aborted/)

    await new Promise(resolve => setTimeout(resolve, 0))

    onClose()
  })

  it('waits until open before sending', async () => {
    let onOpen: any

    const websocket = {
      readyState: 0,
      addEventListener: vi.fn((event, callback) => {
        if (event === 'message')
          onMessage = callback
        if (event === 'close')
          onClose = callback
        if (event === 'open')
          onOpen = callback
      }),
      send: vi.fn(),
    }
    const orpc = createORPCClient(new RPCLink({
      websocket,
    })) as any

    const promise = expect(orpc.ping('input')).resolves.toEqual('pong')

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(websocket.send).toHaveBeenCalledTimes(0)

    onOpen()
    await vi.waitFor(() => expect(websocket.send).toHaveBeenCalledTimes(1))

    const [id] = (await decodeRequestMessage(websocket.send.mock.calls[0]![0]))
    onMessage({ data: await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }) })

    await promise
  })
})
