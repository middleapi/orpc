import type { AnyORPCError } from '@orpc/client'
import type { Promisable } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standardserver/core'
import type { Context } from '../../context'
import type { AnyProcedure } from '../../procedure'
import type { StandardHandlerHandleOptions } from './handler'

export interface StandardHandlerCodecResolvedProcedure {
  path: string[]
  procedure: AnyProcedure
  decodeInput: () => Promise<unknown>
}

export interface StandardHandlerCodec<T extends Context> {
  resolveProcedure(
    request: StandardLazyRequest,
    options: StandardHandlerHandleOptions<T>
  ): Promisable<StandardHandlerCodecResolvedProcedure | undefined>

  encodeOutput(
    output: unknown,
    procedure: AnyProcedure,
    path: string[],
    options: StandardHandlerHandleOptions<T>
  ): Promisable<StandardResponse>

  encodeError(
    error: AnyORPCError,
    procedure: AnyProcedure,
    path: string[],
    options: StandardHandlerHandleOptions<T>
  ): Promisable<StandardResponse>
}
