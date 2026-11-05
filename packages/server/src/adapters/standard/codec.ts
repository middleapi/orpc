import type { AnyORPCError } from '@orpc/client'
import type { Promisable } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'

import type { Context } from '../../context.ts'
import type { AnyProcedure } from '../../procedure.ts'
import type { ResolvedStandardHandlerHandleOptions } from './handler.ts'

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

  encodeError(
    error: AnyORPCError,
    procedure: AnyProcedure,
    path: string[],
    options: ResolvedStandardHandlerHandleOptions<T>,
  ): Promisable<StandardResponse>
}
