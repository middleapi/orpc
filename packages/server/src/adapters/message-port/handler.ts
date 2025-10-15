import type { SupportedMessagePort } from '@orpc/client/message-port'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { BaseMessageFormat, SerializedRequestPayload } from '@orpc/standard-server-peer'
import type { Context } from '../../context'
import type { StandardHandler } from '../standard'
import type {
  HandleStandardServerPeerMessageOptions,
} from '../standard-peer'
import { onMessagePortClose, onMessagePortMessage, postMessagePortMessage } from '@orpc/client/message-port'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { MessageType, ServerPeer } from '@orpc/standard-server-peer'
import { createServerPeerHandleRequestFn } from '../standard-peer'

export class MessagePortHandler<T extends Context> {
  constructor(
    private readonly standardHandler: StandardHandler<T>,
  ) {
  }

  upgrade(
    port: SupportedMessagePort,
    ...rest: MaybeOptionalOptions<HandleStandardServerPeerMessageOptions<T>>
  ): void {
    const peer = new ServerPeer((message) => {
      return postMessagePortMessage(port, message)
    })

    onMessagePortMessage(port, async (raw) => {
      const { i, t, p } = raw as BaseMessageFormat<SerializedRequestPayload>
      if (t && t !== MessageType.REQUEST)
        return

      const SHORTABLE_ORIGIN = 'orpc://localhost'
      const payload = {
        url: p.u.startsWith('/') ? new URL(`${SHORTABLE_ORIGIN}${p.u}`) : new URL(p.u),
        headers: p.h ?? {},
        method: p.m ?? 'POST',
        body: p.b,
      }

      await peer.message(
        [i, t ?? MessageType.REQUEST, payload],
        createServerPeerHandleRequestFn(this.standardHandler, resolveMaybeOptionalOptions(rest)),
      )
    })

    onMessagePortClose(port, () => {
      peer.close()
    })
  }
}
