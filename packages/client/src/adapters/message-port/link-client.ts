import type { Promisable, Value } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { DecodedRequestMessage, DecodedResponseMessage } from '@orpc/standard-server-peer'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkClient } from '../standard'
import type { SupportedMessagePort } from './message-port'
import { value } from '@orpc/shared'
import { experimental_ClientPeerWithoutCodec as ClientPeerWithoutCodec, decodeResponseMessage, encodeRequestMessage } from '@orpc/standard-server-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from './message-port'

export interface LinkMessagePortClientOptions {
  port: SupportedMessagePort

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
  experimental_transfer?: Value<Promisable<object[] | null | undefined>, [message: DecodedRequestMessage]>
}

export class LinkMessagePortClient<T extends ClientContext> implements StandardLinkClient<T> {
  private readonly peer: ClientPeerWithoutCodec

  constructor(options: LinkMessagePortClientOptions) {
    this.peer = new ClientPeerWithoutCodec(async (message) => {
      const transfer = options.experimental_transfer && await value(options.experimental_transfer, message)

      if (transfer) {
        return postMessagePortMessage(options.port, message, transfer)
      }

      const [id, type, payload] = message
      return postMessagePortMessage(options.port, await encodeRequestMessage(id, type, payload))
    })

    onMessagePortMessage(options.port, async (message) => {
      if (Array.isArray(message)) {
        return await this.peer.message(message as DecodedResponseMessage)
      }

      return await this.peer.message(await decodeResponseMessage(message))
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
