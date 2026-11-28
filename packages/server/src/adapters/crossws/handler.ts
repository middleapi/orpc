import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { HandleStandardServerPeerMessageOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions, sequential } from '@orpc/shared'
import { encodeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn, decodeServerPeerRequestMessage } from '../standard-peer'

export class experimental_CrosswsHandler<T extends Context> {
  private readonly peers: WeakMap<Pick<Peer, 'send'>, { peer: ServerPeerWithoutCodec, decode: typeof decodeServerPeerRequestMessage }> = new WeakMap()

  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  async message(
    ws: Pick<Peer, 'send'>,
    message: Pick<Message, 'rawData' | 'uint8Array'>,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): Promise<void> {
    let state = this.peers.get(ws)

    if (!state) {
      this.peers.set(ws, state = {
        peer: new ServerPeerWithoutCodec(async ([id, type, payload]) => {
          ws.send(await encodeResponseMessage(id, type, payload))
        }),
        // Decode in order, so event iterator messages can't overtake their slower-to-decode request
        decode: sequential(decodeServerPeerRequestMessage),
      })
    }

    const decodedMessage = await state.decode(
      typeof message.rawData === 'string' ? message.rawData : message.uint8Array(),
    )

    if (!decodedMessage) {
      return
    }

    await state.peer.message(
      decodedMessage,
      createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
    )
  }

  close(ws: Pick<Peer, 'send'>): void {
    const state = this.peers.get(ws)

    if (state) {
      state.peer.close()
      this.peers.delete(ws)
    }
  }
}
