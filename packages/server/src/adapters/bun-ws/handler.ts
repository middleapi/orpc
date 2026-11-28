import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodedRequestMessage, EncodedMessage } from '@orpc/standard-server-peer'
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
  private readonly peers: WeakMap<ServerWebSocket, ServerPeerWithoutCodec> = new WeakMap()
  private readonly decoders: WeakMap<ServerWebSocket, (message: EncodedMessage) => Promise<DecodedRequestMessage | undefined>> = new WeakMap()

  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  async message(
    ws: ServerWebSocket,
    message: string | ArrayBufferView,
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
      typeof message === 'string'
        ? message
        : new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
    )

    if (!decodedMessage) {
      return
    }

    await peer.message(
      decodedMessage,
      createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
    )
  }

  close(ws: ServerWebSocket): void {
    const server = this.peers.get(ws)

    if (server) {
      server.close()
      this.peers.delete(ws)
      this.decoders.delete(ws)
    }
  }
}
