import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkClient } from '../standard'
import { readAsBuffer } from '@orpc/shared'
import { ClientPeer } from '@orpc/standard-server-peer'

/**
 * Some env maybe not available WebSocket global
 */
const WEBSOCKET_CONNECTING = 0 satisfies WebSocket['CONNECTING']
const WEBSOCKET_OPEN = 1 satisfies WebSocket['OPEN']

export interface LinkWebsocketClientOptions {
  websocket: Pick<WebSocket, 'addEventListener' | 'removeEventListener' | 'send' | 'readyState'>
}

export class LinkWebsocketClient<T extends ClientContext> implements StandardLinkClient<T> {
  private readonly peer: ClientPeer

  constructor(options: LinkWebsocketClientOptions) {
    this.peer = new ClientPeer(async (message) => {
      if (options.websocket.readyState === WEBSOCKET_CONNECTING) {
        await new Promise<void>((resolve) => {
          const settle = () => {
            options.websocket.removeEventListener('open', settle)
            options.websocket.removeEventListener('close', settle)
            resolve()
          }

          options.websocket.addEventListener('open', settle, { once: true })
          options.websocket.addEventListener('close', settle, { once: true })
        })
      }

      if (options.websocket.readyState !== WEBSOCKET_OPEN) {
        throw new Error('Cannot send message, WebSocket is not open.')
      }

      return options.websocket.send(message)
    })

    options.websocket.addEventListener('message', async (event) => {
      const message = event.data instanceof Blob
        ? await readAsBuffer(event.data)
        : event.data

      this.peer.message(message)
    })

    options.websocket.addEventListener('close', () => {
      this.peer.close()
    })
  }

  async call(request: StandardRequest, _options: ClientOptions<T>, _path: readonly string[], _input: unknown): Promise<StandardLazyResponse> {
    const response = await this.peer.request(request)
    return { ...response, body: () => Promise.resolve(response.body) }
  }
}
