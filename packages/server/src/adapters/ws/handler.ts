import type { MaybeOptionalOptions } from '@orpc/shared'
import type { WebSocket } from 'ws'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type {
  HandleStandardServerPeerMessageOptions,
} from '../standard-peer'
import { readAsBuffer, resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodeRequestMessage, ServerPeer } from '@orpc/standard-server-peer'
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

      await peer.message(
        await decodeRequestMessage(message),
        createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
      )
    })

    ws.addEventListener('close', () => {
      peer.close()
    })
  }
}
