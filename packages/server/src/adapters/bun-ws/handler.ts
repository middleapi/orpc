import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { HandleStandardServerPeerMessageOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions, sequential } from '@orpc/shared'
import { encodeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn, decodeServerPeerRequestMessage } from '../standard-peer'

export interface ServerWebSocket {
  send(message: string | ArrayBufferLike | Uint8Array): number
}

export class BunWsHandler<T extends Context> {
  private readonly peers: WeakMap<ServerWebSocket, { peer: ServerPeerWithoutCodec, decode: typeof decodeServerPeerRequestMessage }> = new WeakMap()

  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  async message(
    ws: ServerWebSocket,
    message: string | ArrayBufferView,
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
      typeof message === 'string'
        ? message
        : new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
    )

    if (!decodedMessage) {
      return
    }

    await state.peer.message(
      decodedMessage,
      createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
    )
  }

  close(ws: ServerWebSocket): void {
    const state = this.peers.get(ws)

    if (state) {
      state.peer.close()
      this.peers.delete(ws)
    }
  }
}
