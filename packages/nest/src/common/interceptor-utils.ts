import type { AbstractHttpAdapter } from '@nestjs/core'
import type { StandardHandler } from '@orpc/server/standard'
import type { NestStandardLazyRequest, ToNestResponseConfig } from './types'
import { HttpException } from '@nestjs/common'
import { isPlainObject } from '@orpc/shared'
import { sendStandardResponseToNest } from './response-adapter'

export async function handleNestStandardExecution(
  handler: StandardHandler<any>,
  standardRequest: NestStandardLazyRequest,
  initialContext: unknown,
  nestResponse: any,
  httpAdapter: AbstractHttpAdapter,
  toNestResponse?: ToNestResponseConfig,
): Promise<any> {
  const result = await handler.handle(standardRequest, { context: initialContext })

  if (!result.matched) {
    throw new TypeError('oRPC NestJS handler returned an unmatched result.')
  }

  if (
    result.response.status >= 300
    && isPlainObject(result.response.body)
  ) {
    throw new HttpException(result.response.body, result.response.status)
  }

  return sendStandardResponseToNest(
    httpAdapter,
    nestResponse,
    result.response,
    toNestResponse,
  )
}
