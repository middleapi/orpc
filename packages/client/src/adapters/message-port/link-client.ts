import type { Promisable, Value } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { DecodedRequestMessage, serializeResponseMessage } from '@orpc/standard-server-peer'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkClient } from '../standard'
import type { SupportedMessagePort } from './message-port'
import { isObject, value } from '@orpc/shared'
import { experimental_ClientPeerWithoutCodec as ClientPeerWithoutCodec, decodeResponseMessage, deserializeResponseMessage, encodeRequestMessage, serializeRequestMessage } from '@orpc/standard-server-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from './message-port'

export interface LinkMessagePortClientOptions {
  port: SupportedMessagePort

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
  experimental_transfer?: Value<Promisable<object[] | null | undefined>, [message: DecodedRequestMessage, port: SupportedMessagePort]>
}

export class LinkMessagePortClient<T extends ClientContext> implements StandardLinkClient<T> {
  private readonly peer: ClientPeerWithoutCodec

  constructor(options: LinkMessagePortClientOptions) {
    this.peer = new ClientPeerWithoutCodec(async (message) => {
      const [id, type, payload] = message
      const transfer = await value(options.experimental_transfer, message, options.port)

      if (transfer) {
        postMessagePortMessage(options.port, serializeRequestMessage(id, type, payload), transfer)
      }
      else {
        postMessagePortMessage(options.port, await encodeRequestMessage(id, type, payload))
      }
    })

    onMessagePortMessage(options.port, async (message) => {
      if (isObject(message)) {
        await this.peer.message(deserializeResponseMessage(message as any as ReturnType<typeof serializeResponseMessage>))
      }
      else {
        await this.peer.message(await decodeResponseMessage(message))
      }
    })

    onMessagePortClose(options.port, () => {
      this.peer.close()
    })
  }

  async call(request: StandardRequest, _options: ClientOptions<T>, _path: readonly string[], _input: unknown): Promise<StandardLazyResponse> {
    const response = await this.peer.request(request)
    return { ...response, body: () => Promise.resolve(response.body) }
  }
}
