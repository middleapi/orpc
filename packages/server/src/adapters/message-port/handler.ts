import type { SupportedMessagePort } from '@orpc/client/message-port'
import type { MaybeOptionalOptions, Promisable, Value } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standardserver/peer'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type { StandardPeerRequestHandlerOptions } from '../standard-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from '@orpc/client/message-port'
import { isPlainObject, resolveMaybeOptionalOptions, toStringOrBytes, value } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standardserver/peer'
import { createStandardPeerRequestHandler } from '../standard-peer'

type DecodedResponseMessage = ConstructorParameters<typeof ServerPeer>[0] extends (message: infer TMessage) => unknown
  ? TMessage
  : never

export interface MessagePortHandlerOptions<_T extends Context> {
  /**
   * By default, oRPC encodes peer messages as strings or binary data before sending them over the message port.
   * Use this option to bypass encoding and leverage the full capabilities of the
   * [MessagePort: postMessage() method](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage),
   * such as transferring object ownership or supporting non-serializable objects like `OffscreenCanvas` or improving performance.
   *
   * @remarks
   * - Returning `null` or `undefined` disables this feature.
   *
   * @warning Ensure your message port implementation supports `transferable` objects before enabling this.
   */
  experimental_transfer?: Value<Promisable<object[] | null | undefined>, [message: DecodedResponseMessage, port: SupportedMessagePort]>

  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Options for decoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  decodePeerMessage?: DecodePeerMessageOptions | undefined
}

export class MessagePortHandler<T extends Context> {
  private readonly peers = new WeakMap<SupportedMessagePort, ServerPeer>()
  private readonly transfer: MessagePortHandlerOptions<T>['experimental_transfer']
  private readonly encodePeerMessageOptions: MessagePortHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: MessagePortHandlerOptions<T>['decodePeerMessage']

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<MessagePortHandlerOptions<T>> = {},
  ) {
    this.transfer = options.experimental_transfer
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
  }

  /**
   * Attaches necessary event listeners to a message port to handle incoming messages and peer management.
   */
  upgrade(
    port: SupportedMessagePort,
    ...rest: MaybeOptionalOptions<StandardPeerRequestHandlerOptions<T>>
  ): void {
    onMessagePortMessage(port, message => this.message(port, message, ...rest))
    onMessagePortClose(port, () => this.close(port))
  }

  /**
   * Handles a single message received from a message port.
   *
   * @warning AVOID calling this method directly if `.upgrade()` is used, as `.upgrade()` already sets up necessary event listeners to call this method for incoming messages and manage peer lifecycle.
   *
   * @param port The message port instance, require consistent instance across messages for proper peer management
   */
  async message(
    port: SupportedMessagePort,
    data: any,
    ...rest: MaybeOptionalOptions<StandardPeerRequestHandlerOptions<T>>
  ): Promise<{ matched: boolean }> {
    let peer = this.peers.get(port)

    if (!peer) {
      this.peers.set(port, peer = new ServerPeer(async (message) => {
        const transfer = await value(this.transfer, message, port)

        if (transfer) {
          postMessagePortMessage(port, message, transfer)
        }
        else {
          postMessagePortMessage(port, await encodePeerMessage(message, this.encodePeerMessageOptions))
        }
      }))
    }

    if (isPlainObject(data)) {
      await peer.message(
        data as any,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
      )

      return { matched: true }
    }

    const message = await toStringOrBytes(data)

    const result = decodePeerMessage(message, this.decodePeerMessageOptions)

    if (result.matched && isClientPeerSendMessage(result.message)) {
      await peer.message(
        result.message,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
      )
    }

    return result
  }

  /**
   * Called when a message port is closed, to clean up any associated peer state.
   *
   * @warning AVOID calling this method directly if `.upgrade()` is used, as `.upgrade()` already sets up necessary event listeners to call this method for incoming messages and manage peer lifecycle.
   *
   * @param port The message port instance to clean up, must be the same instance used in `.message()` calls to properly clean up
   */
  async close(port: SupportedMessagePort): Promise<void> {
    const peer = this.peers.get(port)

    if (peer) {
      await peer.close()
      this.peers.delete(port)
    }
  }
}
