import { decodePeerMessage, encodePeerMessage, ServerPeer } from '@standard-server/peer'
import { ServerPeerRegistry } from './registry'

describe('serverPeerRegistry', () => {
  it('creates a peer on first get and reuses it afterwards', () => {
    const registry = new ServerPeerRegistry<object>()
    const key = {}
    const send = vi.fn(async () => {})
    const createSend = vi.fn(() => send)

    const peer = registry.get(key, createSend)

    expect(peer).toBeInstanceOf(ServerPeer)
    expect(createSend).toHaveBeenCalledTimes(1)

    expect(registry.get(key, createSend)).toBe(peer)
    expect(createSend).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate peer per key', () => {
    const registry = new ServerPeerRegistry<object>()
    const createSend = () => async () => {}

    const peer1 = registry.get({}, createSend)
    const peer2 = registry.get({}, createSend)

    expect(peer1).toBeInstanceOf(ServerPeer)
    expect(peer2).toBeInstanceOf(ServerPeer)
    expect(peer1).not.toBe(peer2)
  })

  it('passes the created send function to the peer', async () => {
    const registry = new ServerPeerRegistry<object>()
    const send = vi.fn(async () => {})

    const peer = registry.get({}, () => send)!

    const encoded = await encodePeerMessage({ id: '1', kind: 'request', json: { url: '/ping', headers: {}, method: 'POST' } })
    const decoded = decodePeerMessage(encoded)
    expect(decoded.matched).toBe(true)

    await peer.message(decoded.message as any, async () => ({ status: 200, headers: {}, body: 'pong' }))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: '1', kind: 'response' }))
  })

  it('closes the peer and returns undefined afterwards', async () => {
    const registry = new ServerPeerRegistry<object>()
    const key = {}
    const createSend = vi.fn(() => async () => {})

    const peer = registry.get(key, createSend)!
    const close = vi.spyOn(peer, 'close')

    await registry.close(key)

    expect(close).toHaveBeenCalledTimes(1)
    expect(registry.get(key, createSend)).toBeUndefined()
    expect(createSend).toHaveBeenCalledTimes(1)
  })

  it('marks the key closed before awaiting peer.close()', async () => {
    const registry = new ServerPeerRegistry<object>()
    const key = {}
    const createSend = vi.fn(() => async () => {})

    const peer = registry.get(key, createSend)!
    let resolveClose!: () => void
    vi.spyOn(peer, 'close').mockReturnValue(new Promise<void>((resolve) => {
      resolveClose = resolve
    }))

    const closing = registry.close(key)

    expect(registry.get(key, createSend)).toBeUndefined()

    resolveClose()
    await closing

    expect(registry.get(key, createSend)).toBeUndefined()
    expect(createSend).toHaveBeenCalledTimes(1)
  })

  it('never creates a peer for a key closed before first use', async () => {
    const registry = new ServerPeerRegistry<object>()
    const key = {}
    const createSend = vi.fn(() => async () => {})

    await registry.close(key)

    expect(registry.get(key, createSend)).toBeUndefined()
    expect(createSend).not.toHaveBeenCalled()
  })

  it('is safe to close multiple times', async () => {
    const registry = new ServerPeerRegistry<object>()
    const key = {}

    const peer = registry.get(key, () => async () => {})!
    const close = vi.spyOn(peer, 'close')

    await registry.close(key)
    await registry.close(key)

    expect(close).toHaveBeenCalledTimes(1)
  })
})
