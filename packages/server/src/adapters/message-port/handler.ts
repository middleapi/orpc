import type { SupportedMessagePort } from '@orpc/client/message-port'
import type { MaybeOptionalOptions, Promisable, Value } from '@orpc/shared'
import type { DecodedRequestMessage, DecodedResponseMessage } from '@orpc/standard-server-peer'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type {
  HandleStandardServerPeerMessageOptions,
} from '../standard-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from '@orpc/client/message-port'
import { resolveMaybeOptionalOptions, value } from '@orpc/shared'
import { decodeRequestMessage, encodeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn } from '../standard-peer'

export interface MessagePortHandlerOptions<_T extends Context> {
  /**
   * Specify transferable objects (like ArrayBuffers, MessagePorts)
   * that should be transferred rather than cloned when sending messages.
   *
   * @remarks
   * - return null | undefined to disable this feature
   *
   * @warning Make sure your message port supports `transfer` before using this feature.
   * @example
   * ```ts
   * experimental_transfer: (message) => {
   *   return deepFindTransferableObjects(message)
   * }
   * ```
   */
  experimental_transfer?: Value<Promisable<object[] | null | undefined>, [message: DecodedResponseMessage]>
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
      const transfer = this.transfer && await value(this.transfer, message)

      if (transfer) {
        return postMessagePortMessage(port, message, transfer)
      }

      const [id, type, payload] = message
      return postMessagePortMessage(port, await encodeResponseMessage(id, type, payload))
    })

    onMessagePortMessage(port, async (message) => {
      if (Array.isArray(message)) {
        return await peer.message(message as DecodedRequestMessage)
      }

      await peer.message(
        await decodeRequestMessage(message),
        createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
      )
    })

    onMessagePortClose(port, () => {
      peer.close()
    })
  }
}
