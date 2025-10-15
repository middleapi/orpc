import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkClient } from '../standard'
import type { SupportedMessagePort, SupportedMessagePortData } from './message-port'
import { ClientPeer, encodeMessagePortRequest } from '@orpc/standard-server-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from './message-port'

export interface LinkMessagePortClientOptions {
  port: SupportedMessagePort
}

export class LinkMessagePortClient<T extends ClientContext> implements StandardLinkClient<T> {
  private readonly peer: ClientPeer

  constructor(options: LinkMessagePortClientOptions) {
    this.peer = new ClientPeer(async (id, type, payload, payloadOptions) => {
      const message = await encodeMessagePortRequest(id, type, payload)
      if (!message)
        return

      return postMessagePortMessage(options.port, message, payloadOptions)
    })

    onMessagePortMessage(options.port, async (message) => {
      await this.peer.message(message as Exclude<SupportedMessagePortData, object>)
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
