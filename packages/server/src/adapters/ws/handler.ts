import type { MaybeOptionalOptions } from '@orpc/shared'
import type { WebSocket } from 'ws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type {
  HandleStandardServerPeerMessageOptions,
} from '../standard-peer'
import { logError, readAsBuffer, resolveMaybeOptionalOptions, sequential } from '@orpc/shared'
import { encodeResponseMessage, experimental_ServerPeerWithoutCodec as ServerPeerWithoutCodec } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn, decodeServerPeerRequestMessage } from '../standard-peer'

export class WsHandler<T extends Context> {
  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  async upgrade(
    ws: Pick<WebSocket, 'addEventListener' | 'send'>,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): Promise<void> {
    const peer = new ServerPeerWithoutCodec(async ([id, type, payload]) => {
      ws.send(await encodeResponseMessage(id, type, payload))
    })

    // Decode in order, so event iterator messages can't overtake their slower-to-decode request
    const decode = sequential(async (data: WebSocket.Data) => decodeServerPeerRequestMessage(
      Array.isArray(data) ? await readAsBuffer(new Blob(data)) : data,
    ))

    ws.addEventListener('message', async (event) => {
      const message = await decode(event.data)

      if (!message) {
        return
      }

      try {
        await peer.message(
          message,
          createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
        )
      }
      catch (error) {
        /**
         * Users cannot catch errors thrown by this `peer.message`, and node.js may
         * crash on unhandled rejections, so we log the error here to prevent that.
         */
        logError(error)
      }
    })

    ws.addEventListener('close', () => {
      peer.close()
    })
  }
}
