import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { HandleStandardServerPeerMessageOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodeRequestMessage, ServerPeer } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn } from '../standard-peer'

export interface ServerWebSocket {
  send(message: string | ArrayBufferLike | Uint8Array): number
}

export class BunWsHandler<T extends Context> {
  private readonly peers: WeakMap<ServerWebSocket, ServerPeer> = new WeakMap()

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

    if (!peer) {
      this.peers.set(ws, peer = new ServerPeer(
        (message) => { ws.send(message) },
      ))
    }

    const encodedMessage = typeof message === 'string'
      ? message
      : new Uint8Array(message.buffer, message.byteOffset, message.byteLength)

    await peer.message(
      await decodeRequestMessage(encodedMessage),
      createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
    )
  }

  close(ws: ServerWebSocket): void {
    const server = this.peers.get(ws)

    if (server) {
      server.close()
      this.peers.delete(ws)
    }
  }
}
