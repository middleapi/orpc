import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { HandleStandardServerPeerMessageOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodeRequestMessage, ServerPeer } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn } from '../standard-peer'

export class experimental_CrosswsHandler<T extends Context> {
  private readonly peers: WeakMap<Pick<Peer, 'send'>, ServerPeer> = new WeakMap()

  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  async message(
    ws: Pick<Peer, 'send'>,
    message: Pick<Message, 'rawData' | 'uint8Array'>,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): Promise<void> {
    let peer = this.peers.get(ws)

    if (!peer) {
      this.peers.set(ws, peer = new ServerPeer((message) => {
        ws.send(message)
      }))
    }

    const encodedMessage = typeof message.rawData === 'string' ? message.rawData : message.uint8Array()

    await peer.message(
      await decodeRequestMessage(encodedMessage),
      createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
    )
  }

  close(ws: Pick<Peer, 'send'>): void {
    const server = this.peers.get(ws)

    if (server) {
      server.close()
      this.peers.delete(ws)
    }
  }
}
