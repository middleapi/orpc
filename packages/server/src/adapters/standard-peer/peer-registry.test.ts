import { ServerPeer } from '@standard-server/peer'
import { PeerRegistry } from './peer-registry'

describe('peerRegistry', () => {
  const createPeer = () => new ServerPeer(async () => {})

  it('creates a peer lazily and reuses it for the same key', () => {
    const registry = new PeerRegistry<object>()
    const key = {}
    const create = vi.fn(createPeer)

    const peer = registry.getOrCreate(key, create)

    expect(peer).toBeInstanceOf(ServerPeer)
    expect(registry.getOrCreate(key, create)).toBe(peer)
    expect(create).toHaveBeenCalledTimes(1)

    expect(registry.getOrCreate({}, create)).not.toBe(peer)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('closes the peer and returns undefined for a closed key', async () => {
    const registry = new PeerRegistry<object>()
    const key = {}
    const peer = registry.getOrCreate(key, createPeer)!
    const close = vi.spyOn(peer, 'close')

    await registry.close(key)

    expect(close).toHaveBeenCalledTimes(1)

    const create = vi.fn(createPeer)
    expect(registry.getOrCreate(key, create)).toBeUndefined()
    expect(create).not.toHaveBeenCalled()

    await registry.close(key) // safe to invoke multiple times
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('marks a key closed before its peer finishes closing', async () => {
    const registry = new PeerRegistry<object>()
    const key = {}
    const peer = registry.getOrCreate(key, createPeer)!

    let releaseClose: (() => void) | undefined
    vi.spyOn(peer, 'close').mockImplementation(() => new Promise<void>((resolve) => {
      releaseClose = resolve
    }))

    const closing = registry.close(key)

    const create = vi.fn(createPeer)
    expect(registry.getOrCreate(key, create)).toBeUndefined()
    expect(create).not.toHaveBeenCalled()

    releaseClose!()
    await closing
  })

  it('marks a key closed even if it never had a peer', async () => {
    const registry = new PeerRegistry<object>()
    const key = {}

    await registry.close(key)

    const create = vi.fn(createPeer)
    expect(registry.getOrCreate(key, create)).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })
})
