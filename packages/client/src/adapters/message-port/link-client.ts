import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { BaseMessageFormat, MessageType, RequestMessageMap, SerializedRequestPayload } from '@orpc/standard-server-peer'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkClient } from '../standard'
import type { SupportedMessagePort } from './message-port'
import { ClientPeer } from '@orpc/standard-server-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from './message-port'

export interface LinkMessagePortClientOptions {
  port: SupportedMessagePort
}

export class LinkMessagePortClient<T extends ClientContext> implements StandardLinkClient<T> {
  private readonly peer: ClientPeer

  constructor(options: LinkMessagePortClientOptions) {
    this.peer = new ClientPeer((id, type, payload, payloadOptions) => {
      const SHORTABLE_ORIGIN_MATCHER = /^orpc:\/\/localhost\//
      const request = payload as RequestMessageMap[MessageType.REQUEST]

      const p: SerializedRequestPayload = {
        u: request.url.toString().replace(SHORTABLE_ORIGIN_MATCHER, '/'),
        b: request.body,
      }

      const message: BaseMessageFormat<SerializedRequestPayload> = {
        i: id,
        t: type,
        p,
      }

      return postMessagePortMessage(options.port, message, payloadOptions)
    })

    onMessagePortMessage(options.port, async (message) => {
      await this.peer.message(message)
    })

    onMessagePortClose(options.port, () => {
      this.peer.close()
    })
  }

  async call(request: StandardRequest, options: ClientOptions<T>, _path: readonly string[], _input: unknown): Promise<StandardLazyResponse> {
    const response = await this.peer.request(request, { transfer: options.transfer })
    return { ...response, body: () => Promise.resolve(response.body) }
  }
}
