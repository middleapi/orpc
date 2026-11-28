import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodedRequestMessage, EncodedMessage } from '@orpc/standard-server-peer'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { HandleStandardServerPeerMessageOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions, sequential } from '@orpc/shared'
import { encodeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn, decodeServerPeerRequestMessage } from '../standard-peer'

export class experimental_CrosswsHandler<T extends Context> {
  private readonly peers: WeakMap<Pick<Peer, 'send'>, ServerPeerWithoutCodec> = new WeakMap()
  private readonly decoders: WeakMap<Pick<Peer, 'send'>, (message: EncodedMessage) => Promise<DecodedRequestMessage | undefined>> = new WeakMap()

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
    let decode = this.decoders.get(ws)

    if (!peer) {
      this.peers.set(ws, peer = new ServerPeerWithoutCodec(async ([id, type, payload]) => {
        ws.send(await encodeResponseMessage(id, type, payload))
      }))
    }

    if (!decode) {
      /**
       * Decodes sequentially, a request message takes longer to decode than the messages after it,
       * so they could otherwise reach the peer first and be dropped.
       */
      this.decoders.set(ws, decode = sequential(decodeServerPeerRequestMessage))
    }

    const decodedMessage = await decode(
      typeof message.rawData === 'string' ? message.rawData : message.uint8Array(),
    )

    if (!decodedMessage) {
      return
    }

    await peer.message(
      decodedMessage,
      createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
    )
  }

  close(ws: Pick<Peer, 'send'>): void {
    const server = this.peers.get(ws)

    if (server) {
      server.close()
      this.peers.delete(ws)
      this.decoders.delete(ws)
    }
  }
}
