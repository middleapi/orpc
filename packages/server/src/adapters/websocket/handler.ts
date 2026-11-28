import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodedRequestMessage } from '@orpc/standard-server-peer'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { HandleStandardServerPeerMessageOptions } from '../standard-peer'
import { readAsBuffer, resolveMaybeOptionalOptions, sequential } from '@orpc/shared'
import { encodeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn, decodeServerPeerRequestMessage } from '../standard-peer'

export type MinimalWebsocket = Pick<WebSocket, 'addEventListener' | 'send'>

export class WebsocketHandler<T extends Context> {
  readonly #peers = new WeakMap<MinimalWebsocket, ServerPeerWithoutCodec>()
  readonly #decoders = new WeakMap<MinimalWebsocket, (data: string | ArrayBuffer | Blob) => Promise<DecodedRequestMessage | undefined>>()
  readonly #handler: StandardHandler<T>

  constructor(
    standardHandler: StandardHandler<T>,
  ) {
    this.#handler = standardHandler
  }

  /**
   * Upgrades a WebSocket to enable handling
   *
   * This attaches the necessary 'message' and 'close' listeners to the WebSocket
   *
   * @warning Do not use this method if you're using `.message()` or `.close()`
   */
  upgrade(
    ws: MinimalWebsocket,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): void {
    ws.addEventListener('message', event => this.message(ws, event.data, ...rest))
    ws.addEventListener('close', () => this.close(ws))
  }

  /**
   * Handles a single message received from a WebSocket.
   *
   * @warning Avoid calling this directly if `.upgrade()` is used.
   *
   * @param ws The WebSocket instance
   * @param data The message payload, usually place in `event.data`
   */
  async message(
    ws: MinimalWebsocket,
    data: string | ArrayBuffer | Blob,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): Promise<void> {
    let peer = this.#peers.get(ws)
    let decode = this.#decoders.get(ws)

    if (!peer) {
      this.#peers.set(ws, peer = new ServerPeerWithoutCodec(async ([id, type, payload]) => {
        ws.send(await encodeResponseMessage(id, type, payload))
      }))
    }

    if (!decode) {
      /**
       * Decodes sequentially, a request message takes longer to decode than the messages after it,
       * so they could otherwise reach the peer first and be dropped.
       */
      this.#decoders.set(ws, decode = sequential(async data => decodeServerPeerRequestMessage(
        data instanceof Blob ? await readAsBuffer(data) : data,
      )))
    }

    const message = await decode(data)

    if (!message) {
      return
    }

    await peer.message(
      message,
      createServerPeerHandleRequestFn(this.#handler, resolveMaybeOptionalOptions(rest)),
    )
  }

  /**
   * Closes the WebSocket peer and cleans up.
   *
   * @warning Avoid calling this directly if `.upgrade()` is used.
   */
  close(ws: MinimalWebsocket): void {
    const peer = this.#peers.get(ws)

    if (peer) {
      peer.close()
    }
  }
}
