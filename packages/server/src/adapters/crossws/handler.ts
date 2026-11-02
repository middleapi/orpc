import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standard-server/peer'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standard-server/peer'
import { createStandardPeerRequestHandler, PeerRegistry } from '../standard-peer'

export type CrosswsPeerLike = Pick<Peer, 'send'>
export type CrosswsMessageLike = Pick<Message, 'rawData' | 'uint8Array'>

export interface experimental_CrosswsHandlerOptions<_T extends Context> {
  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Options for decoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  decodePeerMessage?: DecodePeerMessageOptions | undefined
}

export class experimental_CrosswsHandler<T extends Context> {
  private readonly peers: PeerRegistry<CrosswsPeerLike> = new PeerRegistry()
  private readonly encodePeerMessageOptions: experimental_CrosswsHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: experimental_CrosswsHandlerOptions<T>['decodePeerMessage']

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<experimental_CrosswsHandlerOptions<T>> = {},
  ) {
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
  }

  /**
   * Handles a single WebSocket message.
   *
   * Message order matters. Call this immediately after receiving a message,
   * before any other async work, to preserve ordering.
   *
   * @param ws The crossws peer instance. Use the same instance for all messages.
   */
  async message(
    ws: CrosswsPeerLike,
    message: CrosswsMessageLike,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<{ matched: boolean }> {
    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    const encodedMessage = typeof message.rawData === 'string' ? message.rawData : message.uint8Array() as Uint8Array<ArrayBuffer>
    const result = decodePeerMessage(encodedMessage, this.decodePeerMessageOptions)
    if (result.matched && isClientPeerSendMessage(result.message)) {
      const peer = this.peers.getOrCreate(ws, () => new ServerPeer(async (message) => {
        ws.send(await encodePeerMessage(message, this.encodePeerMessageOptions))
      }))

      // `ws` has been closed, ignore the message
      if (!peer) {
        return result
      }

      await peer.message(
        result.message,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
      )
    }

    return result
  }

  /**
   * Cleans up peer state for a closed WebSocket.
   *
   * @param ws The same crossws peer instance passed to `.message()`.
   */
  async close(ws: CrosswsPeerLike): Promise<void> {
    await this.peers.close(ws)
  }
}
