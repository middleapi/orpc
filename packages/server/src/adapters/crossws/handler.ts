import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standard-server/peer'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import { isWebSocketKeepAliveMessage, WEBSOCKET_KEEP_ALIVE_PING, WEBSOCKET_KEEP_ALIVE_PONG } from '@orpc/client/websocket'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standard-server/peer'
import { createStandardPeerRequestHandler } from '../standard-peer'

export type CrosswsPeerLike = Pick<Peer, 'send'> & Partial<Pick<Peer, 'close'>>
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

  /**
   * Closes a peer with code 1001 (Going Away) when no message, keep-alive pings included,
   * arrives within this many milliseconds, so clients with `reconnect` enabled reconnect.
   *
   * Only incoming messages reset the timer, so a client that only receives a stream is closed too:
   * enable the client's `keepAlive` with an `interval` well below this value.
   * The timer starts on the first `.message()` call.
   *
   * @default undefined (disabled)
   */
  idleTimeout?: undefined | number
}

export class experimental_CrosswsHandler<T extends Context> {
  private readonly peers: WeakMap<CrosswsPeerLike, ServerPeer> = new WeakMap()
  private readonly idleTimers: WeakMap<CrosswsPeerLike, ReturnType<typeof setTimeout>> = new WeakMap()
  private readonly encodePeerMessageOptions: experimental_CrosswsHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: experimental_CrosswsHandlerOptions<T>['decodePeerMessage']
  private readonly idleTimeout: experimental_CrosswsHandlerOptions<T>['idleTimeout']
  private readonly keepAlivePing: string
  private readonly keepAlivePong: string

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<experimental_CrosswsHandlerOptions<T>> = {},
  ) {
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
    this.idleTimeout = options.idleTimeout
    this.keepAlivePing = `${options.decodePeerMessage?.prefix ?? ''}${WEBSOCKET_KEEP_ALIVE_PING}`
    this.keepAlivePong = `${options.encodePeerMessage?.prefix ?? ''}${WEBSOCKET_KEEP_ALIVE_PONG}`
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
    this.resetIdleTimer(ws)

    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    const encodedMessage = typeof message.rawData === 'string' ? message.rawData : message.uint8Array() as Uint8Array<ArrayBuffer>

    if (isWebSocketKeepAliveMessage(encodedMessage, this.keepAlivePing)) {
      ws.send(this.keepAlivePong)
      return { matched: true }
    }

    let peer = this.peers.get(ws)

    if (!peer) {
      this.peers.set(ws, peer = new ServerPeer(async (message) => {
        ws.send(await encodePeerMessage(message, this.encodePeerMessageOptions))
      }))
    }

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
   * Cleans up peer state for a closed WebSocket.
   *
   * @param ws The same crossws peer instance passed to `.message()`.
   */
  async close(ws: CrosswsPeerLike): Promise<void> {
    clearTimeout(this.idleTimers.get(ws))
    this.idleTimers.delete(ws)

    const server = this.peers.get(ws)

    if (server) {
      await server.close()
      this.peers.delete(ws)
    }
  }

  private resetIdleTimer(ws: CrosswsPeerLike): void {
    if (this.idleTimeout === undefined) {
      return
    }

    clearTimeout(this.idleTimers.get(ws))
    this.idleTimers.set(ws, setTimeout(() => {
      ws.close?.(1001, 'Idle timeout')
      // a dead peer may never complete the closing handshake, so release its requests now
      void this.close(ws)
    }, this.idleTimeout))
  }
}
