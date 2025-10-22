import type { SupportedMessagePort } from '@orpc/client/message-port'
import type { MaybeOptionalOptions, Promisable, Value } from '@orpc/shared'
import type { DecodedResponseMessage, serializeRequestMessage } from '@orpc/standard-server-peer'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type {
  HandleStandardServerPeerMessageOptions,
} from '../standard-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from '@orpc/client/message-port'
import { isObject, resolveMaybeOptionalOptions, value } from '@orpc/shared'
import { decodeRequestMessage, deserializeRequestMessage, encodeResponseMessage, serializeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn } from '../standard-peer'

export interface MessagePortHandlerOptions<_T extends Context> {
  /**
   * By default, oRPC serializes request/response messages to string/binary data before sending over message port.
   * If needed, you can define the this option to utilize full power of [MessagePort: postMessage() method](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage),
   * such as transferring ownership of objects to the other side or support unserializable objects like `OffscreenCanvas`.
   *
   * @remarks
   * - return null | undefined to disable this feature
   *
   * @warning Make sure your message port supports `transfer` before using this feature.
   * @example
   * ```ts
   * experimental_transfer: (message, port) => {
   *   const transfer = deepFindTransferableObjects(message) // implement your own logic
   *   return transfer.length ? transfer : null // only enable when needed
   * }
   * ```
   *
   * @see {@link https://orpc.unnoq.com/docs/adapters/message-port#transfer Message Port Transfer Docs}
   */
  experimental_transfer?: Value<Promisable<object[] | null | undefined>, [message: DecodedResponseMessage, port: SupportedMessagePort]>
}

export class MessagePortHandler<T extends Context> {
  private readonly transfer: MessagePortHandlerOptions<T>['experimental_transfer']

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<MessagePortHandlerOptions<T>> = {},
  ) {
    this.transfer = options.experimental_transfer
  }

  upgrade(
    port: SupportedMessagePort,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): void {
    const peer = new ServerPeerWithoutCodec(async (message) => {
      const [id, type, payload] = message
      const transfer = await value(this.transfer, message, port)

      if (transfer) {
        postMessagePortMessage(port, serializeResponseMessage(id, type, payload), transfer)
      }
      else {
        postMessagePortMessage(port, await encodeResponseMessage(id, type, payload))
      }
    })

    onMessagePortMessage(port, async (message) => {
      const handleFn = createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest))

      if (isObject(message)) {
        await peer.message(
          deserializeRequestMessage(message as any as ReturnType<typeof serializeRequestMessage>),
          handleFn,
        )
      }
      else {
        await peer.message(
          await decodeRequestMessage(message),
          handleFn,
        )
      }
    })

    onMessagePortClose(port, () => {
      peer.close()
    })
  }
}
