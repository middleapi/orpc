import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'

import type { Context } from '../../context.ts'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard/index.ts'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard/index.ts'

export function createStandardPeerRequestHandler<T extends Context>(
  handler: StandardHandler<T>,
  options: FriendlyStandardHandlerHandleOptions<T>,
): (request: StandardLazyRequest) => Promise<StandardResponse> {
  return async (request) => {
    const { response } = await handler.handle(
      request,
      resolveFriendlyStandardHandlerHandleOptions(options),
    )
    return response ?? { status: 404, headers: {}, body: 'No procedure matched' }
  }
}
