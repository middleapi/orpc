import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standardserver/peer'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { StandardPeerRequestHandlerOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standardserver/peer'
import { createStandardPeerRequestHandler } from '../standard-peer'

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
  private readonly peers: WeakMap<CrosswsPeerLike, ServerPeer> = new WeakMap()
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
   * Handles a single message received from a crossws Peer.
   *
   * @param ws The crossws Peer instance, require consistent instance across messages for proper peer management
   */
  async message(
    ws: CrosswsPeerLike,
    message: CrosswsMessageLike,
    ...rest: MaybeOptionalOptions<StandardPeerRequestHandlerOptions<T>>
  ): Promise<{ matched: boolean }> {
    let peer = this.peers.get(ws)

    if (!peer) {
      this.peers.set(ws, peer = new ServerPeer(async (message) => {
        ws.send(await encodePeerMessage(message, this.encodePeerMessageOptions))
      }))
    }

    const encodedMessage = typeof message.rawData === 'string' ? message.rawData : message.uint8Array() as Uint8Array<ArrayBuffer>

    const result = decodePeerMessage(encodedMessage, this.decodePeerMessageOptions)

    if (result.matched && isClientPeerSendMessage(result.message)) {
      await peer.message(
        result.message,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
      )
    }

    return result
  }

  /**
   * Closes the peer connection and cleans up associated resources.
   *
   * @param ws The crossws Peer instance to close, require consistent instance for proper peer management
   */
  async close(ws: CrosswsPeerLike): Promise<void> {
    const server = this.peers.get(ws)

    if (server) {
      await server.close()
      this.peers.delete(ws)
    }
  }
}
