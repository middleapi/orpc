import { ORPCError } from '@orpc/client'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardLazyRequest } from '@standard-server/core'

import type { Context } from '../../context'
import type { StandardHandlerHandleOptions } from './handler'

export type FriendlyStandardHandlerHandleOptions<T extends Context> = Omit<
  StandardHandlerHandleOptions<T>,
  'context'
> &
  ({} extends T
    ? { context?: Value<Promisable<T>, [request: StandardLazyRequest]> | undefined }
    : { context: Value<Promisable<T>, [request: StandardLazyRequest]> })

export function resolveFriendlyStandardHandlerHandleOptions<T extends Context>(
  options: FriendlyStandardHandlerHandleOptions<T>,
): StandardHandlerHandleOptions<T> {
  return {
    ...options,
    context: options.context ?? ({} as T), // Context only optional if all fields are optional
  }
}

/**
 * The error answered to a request no procedure matched, by transports that must always respond.
 */
export function createNoProcedureMatchedError(): ORPCError<'NOT_FOUND', undefined> {
  return new ORPCError('NOT_FOUND', { message: 'No procedure matched' })
}
