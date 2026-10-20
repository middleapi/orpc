import type { Public } from '@orpc/shared'
import type { EncodePeerMessageOptions, PeerEventStreamMessage } from '@standard-server/peer'
import { RPCJsonSerializer, toORPCError } from '@orpc/client'
import { unwrapEvent } from '@standard-server/core'
import { encodePeerMessage } from '@standard-server/peer'

export interface EncodeHibernationRPCEventOptions {
  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Serializer for event payloads.
   *
   * @default RPCJsonSerializer
   */
  serializer?: Public<RPCJsonSerializer>

  /**
   * The type of event, each type corresponds a different operation
   *
   * - 'message' = 'yield'
   * - 'error' = 'throw'
   * - 'close' = 'return'
   *
   * @default 'message'
   */
  event?: 'message' | 'error' | 'close'
}

/**
 * Encodes a Hibernation RPC event for sending to clients subscribed
 * through a `HibernationAsyncIteratorClass`.
 *
 * @see {@link https://orpc.dev/docs/integrations/hibernation | Hibernation Integration}
 */
export async function encodeHibernationRPCEvent(
  id: string,
  payload: unknown,
  { event = 'message', serializer = new RPCJsonSerializer(), encodePeerMessage: encodePeerMessageOptions }: EncodeHibernationRPCEventOptions = {},
): Promise<string | Uint8Array<ArrayBuffer>> {
  const [originalData, meta] = unwrapEvent(payload)
  const data = event === 'error' ? toORPCError(originalData).toJSON() : originalData
  // matches how RPCSerializer encodes event iterator values: undefined is sent as is
  const serialized = data === undefined ? undefined : serializer.serializeJson(data)

  const message: PeerEventStreamMessage = {
    kind: 'event-stream',
    id,
    json: {
      ...meta,
      event: event === 'message' ? undefined : event,
      data: serialized === undefined ? undefined : { json: serialized.json, meta: serialized.meta },
    },
  }

  return encodePeerMessage(message, encodePeerMessageOptions)
}
