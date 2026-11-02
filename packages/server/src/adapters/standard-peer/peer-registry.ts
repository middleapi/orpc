import type { ServerPeer } from '@standard-server/peer'

/**
 * Tracks one {@link ServerPeer} per connection (WebSocket, message port, ...).
 *
 * Once a connection is closed it is remembered as closed, so a message that
 * arrives afterwards (e.g. a Blob that finishes loading after close) cannot
 * create a new peer whose requests would never be aborted.
 */
export class PeerRegistry<K extends object> {
  /**
   * `null` marks a closed connection.
   */
  private readonly peers: WeakMap<K, ServerPeer | null> = new WeakMap()

  /**
   * Returns the peer for `key`, creating it with `create` on first use.
   *
   * @returns `undefined` if `key` has already been closed.
   */
  getOrCreate(key: K, create: () => ServerPeer): ServerPeer | undefined {
    let peer = this.peers.get(key)

    if (peer === null) {
      return undefined
    }

    if (peer === undefined) {
      this.peers.set(key, peer = create())
    }

    return peer
  }

  /**
   * Marks `key` as closed, then closes its peer (if any).
   * Safe to call multiple times.
   */
  async close(key: K): Promise<void> {
    const peer = this.peers.get(key)

    // mark closed before awaiting to avoid race conditions with incoming messages
    this.peers.set(key, null)

    await peer?.close()
  }
}
