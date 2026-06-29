import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standardserver/peer'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { StandardPeerRequestHandlerOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions, toStringOrBytes } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standardserver/peer'
import { createStandardPeerRequestHandler } from '../standard-peer'

/**
 * Supports standard WebSocket instances, Bun ServerWebSocket, "ws" ServerWebSocket,
 * Cloudflare WebSocket Hibernation, and similar implementations.
 */
export type WebsocketLike = Pick<WebSocket, 'send'>

export interface WebsocketHandlerOptions<_T extends Context> {
  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Options for decoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  decodePeerMessage?: DecodePeerMessageOptions | undefined
}

export class WebsocketHandler<T extends Context> {
  private readonly peers = new WeakMap<WebsocketLike, ServerPeer>()
  private readonly encodePeerMessageOptions: WebsocketHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: WebsocketHandlerOptions<T>['decodePeerMessage']

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<WebsocketHandlerOptions<T>> = {},
  ) {
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
  }

  /**
   * Handles a single message received from a WebSocket.
   *
   * @warning AVOID calling this method, if `.upgrade()` is used, as `.upgrade()` already sets up necessary event listeners to call this method for incoming messages and manage peer lifecycle.
   *
   * @param ws The WebSocket instance, require consistent instance across messages for proper peer management
   * @param data The message data received from the WebSocket, can be string, ArrayBuffer, Blob, ...
   */
  async message(
    ws: WebsocketLike,
    data: string | ArrayBuffer | Blob | Exclude<ConstructorParameters<typeof Blob>[0], undefined>[0][] | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>,
    ...rest: MaybeOptionalOptions<StandardPeerRequestHandlerOptions<T>>
  ): Promise<{ matched: boolean }> {
    let peer = this.peers.get(ws)

    if (!peer) {
      this.peers.set(ws, peer = new ServerPeer(async (message) => {
        return ws.send(await encodePeerMessage(message, this.encodePeerMessageOptions))
      }))
    }

    const encoded = await toStringOrBytes(data)

    const result = decodePeerMessage(encoded, this.decodePeerMessageOptions)

    if (result.matched && isClientPeerSendMessage(result.message)) {
      await peer.message(
        result.message,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
      )
    }

    return result
  }

  /**
   * Called when a websocket is closed, to clean up any associated peer state.
   *
   * @warning AVOID calling this method, if `.upgrade()` is used, as `.upgrade()` already sets up necessary event listeners to call this method for incoming messages and manage peer lifecycle.
   *
   * @param ws The WebSocket instance to clean up, must be the same instance used in `.message()` calls to properly clean up
   */
  async close(ws: WebsocketLike): Promise<void> {
    const peer = this.peers.get(ws)

    if (peer) {
      await peer.close()
      this.peers.delete(ws)
    }
  }

  /**
   * Attaches websocket event listeners for message and close handling.
   *
   * Use this instead of calling `.message()` and `.close()` manually.
   * Requires a websocket-like object that supports `addEventListener` and `removeEventListener`.
   */
  upgrade(
    ws: Pick<WebSocket, 'send' | 'addEventListener' | 'removeEventListener'>,
    ...rest: MaybeOptionalOptions<StandardPeerRequestHandlerOptions<T>>
  ): void {
    ws.addEventListener('message', event => this.message(ws, event.data, ...rest))
    ws.addEventListener('close', () => this.close(ws))
  }
}
