import type { Promisable, Value } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standardserver/core'
import type { Context } from '../../context'
import type { StandardHandler, StandardHandlerHandleOptions } from '../standard'
import { value } from '@orpc/shared'

export type StandardPeerRequestHandlerOptions<T extends Context>
  = & Omit<StandardHandlerHandleOptions<T>, 'context'>
    & (Record<never, never> extends T ? { context?: Value<Promisable<T>, [request: StandardLazyRequest]> } : { context: Value<Promisable<T>, [request: StandardLazyRequest]> })

export function createStandardPeerRequestHandler<T extends Context>(
  handler: StandardHandler<T>,
  options: StandardPeerRequestHandlerOptions<T>,
): (request: StandardLazyRequest) => Promise<StandardResponse> {
  return async (request) => {
    const context = await value(options.context ?? {} as T, request) as T
    const { response } = await handler.handle(request, { ...options, context })
    return response ?? { status: 404, headers: {}, body: 'No procedure matched' }
  }
}
