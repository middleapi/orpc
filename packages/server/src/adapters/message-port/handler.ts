import type { SupportedMessagePort } from '@orpc/client/message-port'
import type { MaybeOptionalOptions, Promisable, Value } from '@orpc/shared'
import type { ClientPeerSendMessage, DecodePeerMessageOptions, EncodePeerMessageOptions, ServerPeer } from '@standard-server/peer'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import type { StandardPeerGuardOptions } from '../standard-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from '@orpc/client/message-port'
import { resolveMaybeOptionalOptions, value } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, isPeerMessage } from '@standard-server/peer'
import { createStandardPeerRequestHandler, StandardPeerGuard } from '../standard-peer'

type DecodedResponseMessage = ConstructorParameters<typeof ServerPeer>[0] extends (message: infer TMessage) => unknown
  ? TMessage
  : never

/**
 * Has no `sendHighWaterMark`, since a message port does not expose how much it has buffered.
 */
export interface MessagePortHandlerOptions<_T extends Context> extends Omit<StandardPeerGuardOptions, 'sendHighWaterMark'> {
  /**
   * By default, oRPC encodes peer messages as strings or binary data before sending them over the message port.
   * Use this option to bypass encoding and leverage the full capabilities of the
   * [MessagePort: postMessage() method](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage),
   * such as transferring object ownership or supporting non-serializable objects like `OffscreenCanvas` or improving performance.
   *
   * @remarks
   * **Note**: Returning `null` or `undefined` disables this feature.
   * **Warning**: Ensure your message port implementation supports `transferable` objects before enabling this.
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
  private readonly guards = new WeakMap<SupportedMessagePort, StandardPeerGuard>()
  private readonly transfer: MessagePortHandlerOptions<T>['experimental_transfer']
  private readonly encodePeerMessageOptions: MessagePortHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: MessagePortHandlerOptions<T>['decodePeerMessage']
  private readonly guardOptions: StandardPeerGuardOptions

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<MessagePortHandlerOptions<T>> = {},
  ) {
    this.transfer = options.experimental_transfer
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
    this.guardOptions = options
  }

  /**
   * Attaches message and close listeners to a message port.
   *
   * Prefer this over calling `.message()` and `.close()` manually.
   */
  upgrade(
    port: SupportedMessagePort,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): void {
    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    onMessagePortMessage(port, message => this.message(port, message, ...rest))
    onMessagePortClose(port, () => this.close(port))
  }

  /**
   * Handles a single message received from a message port.
   *
   * @param port The message port instance. Use the same instance for all messages.
   */
  async message(
    port: SupportedMessagePort,
    data: unknown,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<{ matched: boolean }> {
    let guard = this.guards.get(port)

    if (!guard) {
      this.guards.set(port, guard = this.createGuard(port))
    }

    let peerMessage: ClientPeerSendMessage | undefined
    let size: Value<number> = 0

    if (typeof data === 'string' || data instanceof Uint8Array) {
      // MessagePort receives the exact payload sent, and `encodePeerMessage` only returns string or Uint8Array.
      const result = decodePeerMessage(data as string | Uint8Array<ArrayBuffer>, this.decodePeerMessageOptions)
      if (result.matched && isClientPeerSendMessage(result.message)) {
        peerMessage = result.message
        size = typeof data === 'string' ? data.length : data.byteLength
      }
    }

    else if (isPeerMessage(data) && isClientPeerSendMessage(data)) {
      peerMessage = data
      size = () => estimateRawPeerMessageSize(data)
    }

    if (peerMessage === undefined) {
      return { matched: false }
    }

    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    await guard.message(
      peerMessage,
      createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
      size,
    )

    return { matched: true }
  }

  /**
   * Cleans up peer state for a closed message port.
   *
   * @param port The same message port instance passed to `.message()`.
   */
  async close(port: SupportedMessagePort): Promise<void> {
    const guard = this.guards.get(port)

    if (guard) {
      // delete before close to avoid potential race conditions
      this.guards.delete(port)
      await guard.close()
    }
  }

  private createGuard(port: SupportedMessagePort): StandardPeerGuard {
    // No `getBufferedAmount`: a message port does not expose it, so sending never waits.
    return new StandardPeerGuard({
      send: async (message) => {
        const transfer = await value(this.transfer, message, port)

        if (transfer) {
          postMessagePortMessage(port, message, transfer)
        }
        else {
          postMessagePortMessage(port, await encodePeerMessage(message, this.encodePeerMessageOptions))
        }
      },
    }, this.guardOptions)
  }
}

/**
 * Estimates the size of a message received as a structured-cloned object.
 * Returns `Infinity` when it cannot, so the message counts as too large.
 */
function estimateRawPeerMessageSize(message: ClientPeerSendMessage): number {
  let size = message.binary instanceof Blob ? message.binary.size : message.binary?.byteLength ?? 0

  try {
    // Needs a replacer, and an `undefined` result is handled below.
    // eslint-disable-next-line ban/ban
    const json = JSON.stringify(message.json, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString()
      }

      if (value instanceof Map || value instanceof Set) {
        return Array.from(value)
      }

      if (value instanceof Blob) {
        size += value.size
        return null
      }

      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        size += value.byteLength
        return null
      }

      return value
    })

    return size + (json?.length ?? 0)
  }
  catch {
    // e.g. circular references
    return Infinity
  }
}
