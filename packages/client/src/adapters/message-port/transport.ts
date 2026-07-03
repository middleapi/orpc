import type { Promisable, Value } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions, ServerPeerSendMessage } from '@standardserver/peer'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkTransport } from '../standard'
import type { SupportedMessagePort } from './message-port'
import { value } from '@orpc/shared'
import { ClientPeer, decodePeerMessage, encodePeerMessage, isPeerMessage, isServerPeerSendMessage } from '@standardserver/peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from './message-port'

type DecodedRequestMessage = ConstructorParameters<typeof ClientPeer>[0] extends (message: infer TMessage) => unknown
  ? TMessage
  : never

export interface MessagePortLinkTransportOptions<_T extends ClientContext> {
  port: SupportedMessagePort

  /**
   * By default, oRPC serializes request/response messages to string/binary data before sending over message port.
   * If needed, define this option to utilize full power of [MessagePort: postMessage() method](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage),
   * such as transferring ownership of objects to the other side or support unserializable objects like `OffscreenCanvas`.
   *
   * @remarks
   * - return null | undefined to disable this feature
   *
   * @warning Make sure your message port supports `transfer` before using this feature.
   */
  experimental_transfer?: Value<Promisable<object[] | null | undefined>, [message: DecodedRequestMessage, port: SupportedMessagePort]>

  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Options for decoding peer messages, such as `prefix` for distinguishing messages on the same channel.
   */
  decodePeerMessage?: DecodePeerMessageOptions | undefined
}

export class MessagePortLinkTransport<T extends ClientContext> implements StandardLinkTransport<T> {
  private readonly peer: ClientPeer

  constructor({ port, experimental_transfer, encodePeerMessage: encodePeerMessageOptions, decodePeerMessage: decodePeerMessageOptions }: MessagePortLinkTransportOptions<T>) {
    this.peer = new ClientPeer(async (message) => {
      const transfer = await value(experimental_transfer, message, port)

      if (transfer) {
        postMessagePortMessage(port, message, transfer)
      }
      else {
        postMessagePortMessage(port, await encodePeerMessage(message, encodePeerMessageOptions))
      }
    })

    onMessagePortMessage(port, async (data) => {
      let peerMessage: ServerPeerSendMessage | undefined

      if (typeof data === 'string' || data instanceof Uint8Array) {
        // MessagePort receives the exact payload sent, and `encodePeerMessage` only returns string or Uint8Array.
        const result = decodePeerMessage(data as string | Uint8Array<ArrayBuffer>, decodePeerMessageOptions)
        if (result.matched && isServerPeerSendMessage(result.message)) {
          peerMessage = result.message
        }
      }

      else if (isPeerMessage(data) && isServerPeerSendMessage(data)) {
        peerMessage = data
      }

      if (peerMessage === undefined) {
        return { matched: false }
      }

      /**
       * Message order is important: loading -> decode -> .message.
       * This flow must stay synchronous, or we need to use `sequential` helper
       */
      await this.peer.message(peerMessage)
      return { matched: true }
    })

    onMessagePortClose(port, () => {
      this.peer.close()
    })
  }

  async send(standardRequest: StandardRequest, _path: string[], _options: ClientOptions<T>): Promise<StandardLazyResponse> {
    const standardResponse = await this.peer.request(standardRequest)
    return standardResponse
  }
}
