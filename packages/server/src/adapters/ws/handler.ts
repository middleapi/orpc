import type { MaybeOptionalOptions } from '@orpc/shared'
import type { WebSocket } from 'ws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type {
  HandleStandardServerPeerMessageOptions,
} from '../standard-peer'
import { logError, readAsBuffer, resolveMaybeOptionalOptions } from '@orpc/shared'
import { ServerPeer } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn } from '../standard-peer'

export class WsHandler<T extends Context> {
  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  async upgrade(
    ws: Pick<WebSocket, 'addEventListener' | 'send'>,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): Promise<void> {
    const peer = new ServerPeer(ws.send.bind(ws))

    ws.addEventListener('message', async (event) => {
      const message = Array.isArray(event.data)
        ? await readAsBuffer(new Blob(event.data))
        : event.data

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
