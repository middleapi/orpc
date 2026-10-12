import type { Promisable } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { AnyORPCError } from '../../error'
import type { ClientContext, ClientOptions } from '../../types'

export type StandardLinkCodecDecodedResponse = { kind: 'output', output: unknown } | { kind: 'error', error: AnyORPCError }

export interface StandardLinkCodec<T extends ClientContext> {
  encodeInput(
    input: unknown,
    path: string[],
    options: ClientOptions<T>
  ): Promisable<StandardRequest>

  decodeResponse(
    response: StandardLazyResponse,
    path: string[],
    options: ClientOptions<T>
  ): Promisable<StandardLinkCodecDecodedResponse>
}

/**
 * Whether a link should decode a response with this status as success.
 * 1xx and 3xx count as success. Status 0 does not: it is an opaque response,
 * e.g. a redirect hidden by fetch's `redirect: 'manual'`.
 */
export function isSuccessResponseStatus(status: number): boolean {
  return status > 0 && status < 400
}
