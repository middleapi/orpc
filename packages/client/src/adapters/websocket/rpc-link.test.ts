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
    removeEventListener: vi.fn(),
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
      url: new URL('http://orpc/ping'),
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
      url: new URL('http://orpc/ping'),
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
      removeEventListener: vi.fn(),
      send: vi.fn(),
    }
    const orpc = createORPCClient(new RPCLink({
      websocket,
    })) as any

    const promise = expect(orpc.ping('input')).resolves.toEqual('pong')

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(websocket.send).toHaveBeenCalledTimes(0)

    websocket.readyState = 1
    onOpen()
    await vi.waitFor(() => expect(websocket.send).toHaveBeenCalledTimes(1))

    const [id] = (await decodeRequestMessage(websocket.send.mock.calls[0]![0]))
    onMessage({ data: await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }) })

    await promise
  })

  describe('non-open sockets', () => {
    function createWebSocket(readyState: number) {
      const listeners = new Map<string, Set<(event?: any) => void>>()

      return {
        readyState,
        addEventListener: vi.fn((event: string, callback: (event?: any) => void) => {
          if (!listeners.has(event)) {
            listeners.set(event, new Set())
          }
          listeners.get(event)!.add(callback)
        }),
        removeEventListener: vi.fn((event: string, callback: (event?: any) => void) => {
          listeners.get(event)?.delete(callback)
        }),
        send: vi.fn(),
        emit: (event: string, payload?: any) => {
          [...listeners.get(event) ?? []].forEach(callback => callback(payload))
        },
      }
    }

    it('rejects instead of sending when socket is not open', async () => {
      const websocket = createWebSocket(3)
      const orpc = createORPCClient(new RPCLink({
        websocket,
      })) as any

      await expect(orpc.ping('input')).rejects.toThrow('WebSocket is not open')
      expect(websocket.send).toHaveBeenCalledTimes(0)
    })

    it('rejects instead of sending when socket closes between requests (reconnecting wrappers)', async () => {
      const websocket = createWebSocket(1)
      const orpc = createORPCClient(new RPCLink({
        websocket,
      })) as any

      const promise = expect(orpc.ping('input')).resolves.toEqual('pong')
      await vi.waitFor(() => expect(websocket.send).toHaveBeenCalledTimes(1))
      const [id] = (await decodeRequestMessage(websocket.send.mock.calls[0]![0]))
      websocket.emit('message', { data: await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }) })
      await promise

      websocket.readyState = 3

      await expect(orpc.ping('input')).rejects.toThrow('WebSocket is not open')
      expect(websocket.send).toHaveBeenCalledTimes(1)
    })

    it('waits during a reconnect window and sends once reopened', async () => {
      const websocket = createWebSocket(1)
      const orpc = createORPCClient(new RPCLink({
        websocket,
      })) as any

      websocket.readyState = 0

      const promise = expect(orpc.ping('input')).resolves.toEqual('pong')

      await new Promise(resolve => setTimeout(resolve, 10))
      expect(websocket.send).toHaveBeenCalledTimes(0)

      websocket.readyState = 1
      websocket.emit('open')
      await vi.waitFor(() => expect(websocket.send).toHaveBeenCalledTimes(1))

      const [id] = (await decodeRequestMessage(websocket.send.mock.calls[0]![0]))
      websocket.emit('message', { data: await encodeResponseMessage(id, MessageType.RESPONSE, { body: { json: 'pong' }, status: 200, headers: {} }) })

      await promise
    })

    it('rejects without sending when a reconnect attempt fails', async () => {
      const websocket = createWebSocket(0)
      const orpc = createORPCClient(new RPCLink({
        websocket,
      })) as any

      const promise = expect(orpc.ping('input')).rejects.toThrow(/aborted|not open/)

      await new Promise(resolve => setTimeout(resolve, 10))
      expect(websocket.send).toHaveBeenCalledTimes(0)

      websocket.readyState = 3
      websocket.emit('close')

      await promise

      websocket.readyState = 1
      websocket.emit('open')
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(websocket.send).toHaveBeenCalledTimes(0)
    })
  })
})
