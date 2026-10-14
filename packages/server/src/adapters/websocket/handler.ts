import type { Arrayable, MaybeOptionalOptions } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standard-server/peer'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import type { StandardPeerGuardOptions } from '../standard-peer'
import { loadBytes, resolveMaybeOptionalOptions, sequential, toStringOrBytes } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage } from '@standard-server/peer'
import { createStandardPeerRequestHandler, StandardPeerGuard } from '../standard-peer'

/**
 * Supports standard WebSocket instances, Bun ServerWebSocket, "ws" ServerWebSocket,
 * Cloudflare WebSocket Hibernation, and similar implementations.
 */
export type WebSocketLike = {
  send: (data: string | Uint8Array<ArrayBuffer>) => unknown

  /**
   * Bytes queued but not yet transmitted, as on standard WebSocket, "ws" and Deno.
   * Used for `sendHighWaterMark`.
   */
  readonly bufferedAmount?: number | undefined

  /**
   * Bytes queued but not yet transmitted, as on Bun ServerWebSocket and uWebSockets.js.
   * Used for `sendHighWaterMark` when `bufferedAmount` is not available.
   */
  getBufferedAmount?: (() => number) | undefined

  /**
   * Above `1` once the connection is closing or closed.
   */
  readonly readyState?: number | undefined
}

export interface WebSocketHandlerOptions<_T extends Context> extends StandardPeerGuardOptions {
  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Options for decoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  decodePeerMessage?: DecodePeerMessageOptions | undefined

  /**
   * Maximum number of bytes buffered on the WebSocket but not yet transmitted before sending waits.
   * While a client does not read, streaming responses stop pulling from procedures, as over HTTP.
   *
   * The buffered amount is read from `bufferedAmount` (standard WebSocket, "ws", Deno)
   * or `getBufferedAmount()` (Bun, uWebSockets.js). Other WebSockets (e.g. Cloudflare) never wait.
   * On Bun and uWebSockets.js, keep it below the runtime's own limit
   * (`backpressureLimit` / `maxBackpressure`), above which they drop messages.
   *
   * Set to `Infinity` to never wait.
   *
   * @default 1024 * 1024 (1 MiB)
   */
  sendHighWaterMark?: number | undefined
}

export class WebSocketHandler<T extends Context> {
  private readonly guards = new WeakMap<WebSocketLike, StandardPeerGuard>()
  private readonly encodePeerMessageOptions: WebSocketHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: WebSocketHandlerOptions<T>['decodePeerMessage']
  private readonly guardOptions: StandardPeerGuardOptions

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<WebSocketHandlerOptions<T>> = {},
  ) {
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
    this.guardOptions = options
  }

  /**
   * Handles a single WebSocket message.
   *
   * Message order matters. Call this immediately after receiving a message,
   * before any other async work, to preserve ordering.
   *
   * To avoid async Blob reads, configure `ws.binaryType` to return binary data
   * directly (for example, `arraybuffer`).
   *
   * @param ws The WebSocket instance. Use the same instance for all messages.
   * @param data The received message. Binary data should already be loaded (not a `Blob`).
   */
  async message(
    ws: WebSocketLike,
    data: Arrayable<string | ArrayBuffer | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>>,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<{ matched: boolean }> {
    let guard = this.guards.get(ws)

    if (!guard) {
      this.guards.set(ws, guard = this.createGuard(ws))
    }

    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    const encoded = toStringOrBytes(data)
    const result = decodePeerMessage(encoded, this.decodePeerMessageOptions)
    if (result.matched && isClientPeerSendMessage(result.message)) {
      await guard.message(
        result.message,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
        typeof encoded === 'string' ? encoded.length : encoded.byteLength,
      )
    }

    return result
  }

  /**
   * Cleans up peer state for a closed WebSocket.
   *
   * @param ws The same WebSocket instance passed to `.message()`.
   */
  async close(ws: WebSocketLike): Promise<void> {
    const guard = this.guards.get(ws)

    if (guard) {
      // delete before close to avoid potential race conditions
      this.guards.delete(ws)
      await guard.close()
    }
  }

  /**
   * Attaches message, close, and error event listeners to a WebSocket.
   *
   * Prefer this over calling `.message()` and `.close()` manually.
   */
  upgrade(
    ws: Pick<WebSocket, 'send' | 'addEventListener' | 'removeEventListener'>,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): void {
    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    ws.addEventListener('message', sequential(async (event) => {
      // For better compatibility avoid control or depend on websocket.binaryType
      const data = event.data instanceof Blob ? await loadBytes(event.data) : event.data

      // Not awaited: `this.message` runs business logic that may be slow,
      // and awaiting it would block decoding of subsequent messages.
      this.message(ws, data, ...rest)
    }))
    ws.addEventListener('close', () => this.close(ws))

    // EventEmitter-based implementations like `ws` throw an unhandled `error` event,
    // so a single malformed frame would crash the process. `close` always follows and handles cleanup.
    ws.addEventListener('error', () => {})
  }

  private createGuard(ws: WebSocketLike): StandardPeerGuard {
    return new StandardPeerGuard({
      send: async (message, sendWhenDrained) => {
        const encoded = await encodePeerMessage(message, this.encodePeerMessageOptions)
        await sendWhenDrained(() => ws.send(encoded))
      },
      getBufferedAmount: () => getBufferedAmount(ws),
    }, this.guardOptions)
  }
}

function getBufferedAmount(ws: WebSocketLike): number | null | undefined {
  if (typeof ws.readyState === 'number' && ws.readyState > 1) {
    return null
  }

  if (typeof ws.bufferedAmount === 'number') {
    return ws.bufferedAmount
  }

  if (typeof ws.getBufferedAmount === 'function') {
    // uWebSockets.js throws once the socket is closed
    return ws.getBufferedAmount()
  }

  return undefined
}
