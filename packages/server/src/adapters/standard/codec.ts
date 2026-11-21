import type { AnyORPCError } from '@orpc/client'
import type { Promisable } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'

import type { Context } from '../../context'
import type { AnyProcedure } from '../../procedure'
import type { ResolvedStandardHandlerHandleOptions } from './handler'

export interface StandardHandlerCodecResolvedProcedure {
  path: string[]
  procedure: AnyProcedure
  decodeInput: () => Promise<unknown>
}

export interface StandardHandlerCodec<T extends Context> {
  resolveProcedure(
    request: StandardLazyRequest,
    options: ResolvedStandardHandlerHandleOptions<T>,
  ): Promisable<StandardHandlerCodecResolvedProcedure | undefined>

  encodeOutput(
    output: unknown,
    procedure: AnyProcedure,
    path: string[],
    options: ResolvedStandardHandlerHandleOptions<T>,
  ): Promisable<StandardResponse>

  /**
   * `procedure`, `path` and `options` are only given for an error of a matched procedure,
   * and not for one raised outside it, such as a refusal by a routing interceptor.
   */
  encodeError(
    error: AnyORPCError,
    procedure?: AnyProcedure,
    path?: string[],
    options?: ResolvedStandardHandlerHandleOptions<T>,
  ): Promisable<StandardResponse>
}
