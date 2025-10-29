import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'
import type { FastifyReply } from 'fastify'
import { Catch, Injectable } from '@nestjs/common'
import { StandardBracketNotationSerializer, StandardOpenAPIJsonSerializer, StandardOpenAPISerializer } from '@orpc/openapi-client/standard'
import { StandardOpenAPICodec } from '@orpc/openapi/standard'
import { ORPCError } from '@orpc/server'
import * as StandardServerFastify from '@orpc/standard-server-fastify'
import * as StandardServerNode from '@orpc/standard-server-node'

const codec = new StandardOpenAPICodec(
  new StandardOpenAPISerializer(
    new StandardOpenAPIJsonSerializer(),
    new StandardBracketNotationSerializer(),
  ),
)

/**
 * Global exception filter that catches ORPCError instances and converts them
 * to standardized oRPC error responses.
 *
 * This filter is optional - you can choose to:
 * 1. Use this filter to get standard oRPC error responses
 * 2. Handle ORPCError in your own custom exception filters
 * 3. Let NestJS default error handling take over
 *
 * @example
 * ```typescript
 * // Register globally in your app
 * app.useGlobalFilters(new ORPCExceptionFilter())
 *
 * // Or register as a provider
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_FILTER,
 *       useClass: ORPCExceptionFilter,
 *     },
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Catch(ORPCError)
@Injectable()
export class ORPCExceptionFilter implements ExceptionFilter {
  constructor(
    private config: StandardServerNode.SendStandardResponseOptions | undefined,
  ) {}

  async catch(exception: ORPCError<any, any>, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response | FastifyReply>()
    const standardResponse = codec.encodeError(exception)
    // Send the response directly with proper status and headers
    const isFastify = 'raw' in res
    if (isFastify) {
      await StandardServerFastify.sendStandardResponse(res as FastifyReply, standardResponse, this.config)
    }
    else {
      await StandardServerNode.sendStandardResponse(res as Response, standardResponse, this.config)
    }
  }
}
