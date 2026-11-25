import type { StandardHeaders } from '@orpc/standard-server'
import type { DecodedRequestMessage, EncodedMessage, ServerPeer, ServerPeerHandleRequestFn } from '@orpc/standard-server-peer'
import type { Context } from '../../context'
import type { FriendlyStandardHandleOptions, StandardHandler } from '../standard'
import { isObject } from '@orpc/shared'
import { decodeRequestMessage, MessageType } from '@orpc/standard-server-peer'
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
    const decoded = await decodeRequestMessage(message)
    return isValidServerPeerRequestMessage(decoded) ? decoded : undefined
  }
  catch {
    return undefined
  }
}

/**
 * Checks the fields of a decoded client request message that later code relies on.
 */
export function isValidServerPeerRequestMessage([id, type, payload]: DecodedRequestMessage): boolean {
  if (typeof id !== 'string') {
    return false
  }

  if (type !== MessageType.REQUEST) {
    return true
  }

  return typeof payload.method === 'string' && isStandardHeaders(payload.headers)
}

function isStandardHeaders(headers: unknown): headers is StandardHeaders {
  return isObject(headers) && Object.values(headers).every(value =>
    value === undefined
    || typeof value === 'string'
    || (Array.isArray(value) && value.every(item => typeof item === 'string')),
  )
}
