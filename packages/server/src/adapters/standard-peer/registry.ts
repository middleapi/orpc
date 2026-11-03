import type { ServerPeerSendMessage } from '@standard-server/peer'
import { ServerPeer } from '@standard-server/peer'

export type ServerPeerSend = (message: ServerPeerSendMessage) => Promise<void>

/**
 * Tracks one {@link ServerPeer} per channel (WebSocket, crossws peer, message port, ...).
 *
 * A closed channel stays marked as closed, so messages that arrive after close
 * never create a new peer that would leak and never be aborted.
 */
export class ServerPeerRegistry<K extends object> {
  /**
   * `null` marks a closed key. Entries are freed when the key is garbage-collected.
   */
  private readonly peers: WeakMap<K, ServerPeer | null> = new WeakMap()

  /**
   * Returns the peer for `key`, creating it on first use.
   * Returns `undefined` once `key` is closed.
   *
   * @param key The channel the peer belongs to.
   * @param createSend Creates the send function of a new peer. Only called when a peer is created.
   */
  get(key: K, createSend: () => ServerPeerSend): ServerPeer | undefined {
    let peer = this.peers.get(key)

    if (peer === null) {
      return undefined
    }

    if (!peer) {
      this.peers.set(key, peer = new ServerPeer(createSend()))
    }

    return peer
  }

  /**
   * Marks `key` as closed, then closes its peer if one was created.
   * Safe to call multiple times.
   */
  async close(key: K): Promise<void> {
    const peer = this.peers.get(key)
    this.peers.set(key, null)
    await peer?.close()
  }
}
