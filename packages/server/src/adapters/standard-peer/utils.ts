import type { DecodedRequestMessage, EncodedMessage, ServerPeer, ServerPeerHandleRequestFn } from '@orpc/standard-server-peer'
import type { Context } from '../../context'
import type { FriendlyStandardHandleOptions, StandardHandler } from '../standard'
import { decodeRequestMessage } from '@orpc/standard-server-peer'
import { resolveFriendlyStandardHandleOptions } from '../standard'

export type HandleStandardServerPeerMessageOptions<T extends Context>
  = Omit<FriendlyStandardHandleOptions<T>, 'prefix'>

/**
 * @deprecated Use `createServerPeerRequestHandleFn` instead.
 */
export async function handleStandardServerPeerMessage<T extends Context>(
  handler: StandardHandler<T>,
  peer: ServerPeer,
  message: EncodedMessage,
  options: HandleStandardServerPeerMessageOptions<T>,
): Promise<void> {
  const [id, request] = await peer.message(message)

  if (!request) {
    return
  }

  const handle = createServerPeerHandleRequestFn(handler, options)
  await peer.response(id, await handle(request))
}

export function createServerPeerHandleRequestFn<T extends Context>(
  handler: StandardHandler<T>,
  options: HandleStandardServerPeerMessageOptions<T>,
): ServerPeerHandleRequestFn {
  return async (request) => {
    const { response } = await handler.handle(
      { ...request, body: () => Promise.resolve(request.body) },
      resolveFriendlyStandardHandleOptions(options),
    )

    return response ?? { status: 404, headers: {}, body: 'No procedure matched' }
  }
}

/**
 * Decodes a request message from a client, or returns `undefined` if it is malformed.
 *
 * Malformed messages are ignored, so a client cannot cause an unhandled rejection with one.
 */
export async function decodeServerPeerRequestMessage(message: EncodedMessage): Promise<DecodedRequestMessage | undefined> {
  try {
    return await decodeRequestMessage(message)
  }
  catch {
    return undefined
  }
}
