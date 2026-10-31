import type { Context, Router } from '@orpc/server'
import type { FriendlyStandardHandlerHandleOptions } from '@orpc/server/standard'
import type { WebSocketLike } from '@orpc/server/websocket'
import type { Arrayable, MaybeOptionalOptions } from '@orpc/shared'
import type { StandardOpenRPCHandlerOptions } from '../standard'
import { resolveFriendlyStandardHandlerHandleOptions } from '@orpc/server/standard'
import { AbortError, loadBytes, resolveMaybeOptionalOptions, sequential, stringifyJSON, toStringOrBytes } from '@orpc/shared'
import { StandardOpenRPCHandler } from '../standard'
import { parseJsonMessage } from './utils'

export interface OpenRPCHandlerOptions<T extends Context> extends StandardOpenRPCHandlerOptions<T> {}

/**
 * Serves oRPC procedures as a JSON-RPC 2.0 API over a WebSocket connection: each message is a request or a batch,
 * answered with a message on the same socket. Supports standard WebSocket instances (Deno, Bun, Cloudflare),
 * Bun ServerWebSocket, "ws" WebSocket, and similar implementations.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#websocket | OpenRPC Handler - WebSocket}
 */
export class OpenRPCHandler<T extends Context> {
  private readonly handler: StandardOpenRPCHandler<T>

  /**
   * Aborts the in-flight calls of a socket once it closes.
   */
  private readonly controllers = new WeakMap<WebSocketLike, AbortController>()

  constructor(router: Router<T>, options: NoInfer<OpenRPCHandlerOptions<T>> = {}) {
    this.handler = new StandardOpenRPCHandler(router, options)
  }

  /**
   * Handles a single WebSocket message, a JSON-RPC request or batch, and sends its response on the same socket.
   * Notifications are not answered.
   *
   * @param ws The WebSocket instance. Use the same instance for all messages.
   * @param data The received message. Binary data should already be loaded (not a `Blob`).
   */
  async message(
    ws: WebSocketLike,
    data: Arrayable<string | ArrayBuffer | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>>,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<{ matched: boolean }> {
    let controller = this.controllers.get(ws)

    if (!controller) {
      this.controllers.set(ws, controller = new AbortController())
    }

    const signal = controller.signal
    const options = resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest))
    // parsed before the first `await`, since some servers, like uWebSockets, detach the message buffer once the listener returns.
    // invalid JSON resolves to `undefined`, which the handler answers with "Parse error"
    const message = parseJsonMessage(toStringOrBytes(data))

    const { matched, response } = await this.handler.handleMessage(message, { ...options, signal })

    if (response?.body !== undefined && !signal.aborted) {
      await ws.send(stringifyJSON(response.body)!)
    }

    return { matched }
  }

  /**
   * Aborts the in-flight calls of a closed WebSocket.
   *
   * @param ws The same WebSocket instance passed to `.message()`.
   */
  close(ws: WebSocketLike): void {
    this.controllers.get(ws)?.abort(new AbortError('WebSocket closed'))
    this.controllers.delete(ws)
  }

  /**
   * Attaches message, close, and error event listeners to a WebSocket.
   *
   * Prefer this over calling `.message()` and `.close()` manually.
   */
  upgrade(
    ws: Pick<WebSocket, 'send' | 'addEventListener'>,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): void {
    // loading a `Blob` is async, so `sequential` keeps the messages in arrival order
    ws.addEventListener('message', sequential(async (event) => {
      const data = event.data instanceof Blob ? await loadBytes(event.data) : event.data
      // not awaited, so a slow call does not hold back the next messages
      this.message(ws, data, ...rest)
    }))
    ws.addEventListener('close', () => this.close(ws))

    // EventEmitter-based implementations like `ws` throw an unhandled `error` event. `close` always follows and handles cleanup.
    ws.addEventListener('error', () => {})
  }
}
