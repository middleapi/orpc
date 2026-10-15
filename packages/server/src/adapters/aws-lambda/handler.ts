import type { MaybeOptionalOptions } from '@orpc/shared'
import type { AnyAPIGatewayProxyEvent, HttpResponseStream, SendStandardResponseOptions } from '@standard-server/aws-lambda'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import { resolveMaybeOptionalOptions, safeEncodeURIComponent } from '@orpc/shared'
import { sendStandardResponse, toStandardLazyRequest } from '@standard-server/aws-lambda'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard'

export type AwsLambdaHandlerHandleResult = { matched: true } | { matched: false }

export interface AwsLambdaHandlerOptions<_T extends Context> {
  /**
   * Custom options for `sendStandardResponse`, used to send a `Standard Response`
   */
  sendStandardResponse?: SendStandardResponseOptions | undefined

  /**
   * Whether the event path (`rawPath` in payload 2.0, `path` in payload 1.0) arrives url-encoded or already url-decoded.
   *
   * API Gateway HTTP APIs deliver the path already decoded, while REST APIs, ALB and Lambda Function URLs deliver it still encoded.
   * A decoded path is re-escaped before matching, so it is decoded only once and a literal `%XX` in it is not decoded a second time.
   *
   * - `'auto'`: payload 1.0 events are decoded when they carry `version: '1.0'` (HTTP API), and payload 2.0 events are decoded
   *   unless `requestContext.domainName` is a Lambda Function URL host (`*.lambda-url.<region>.on.aws`).
   * - `'encoded'`: every path is still encoded.
   * - `'decoded'`: every path is already decoded.
   *
   * @default 'auto'
   */
  pathEncoding?: 'auto' | 'encoded' | 'decoded' | undefined
}

const FUNCTION_URL_DOMAIN_REGEX = /\.lambda-url\.[a-z0-9-]+\.on\.aws$/
/**
 * Everything but RFC 3986 unreserved characters, sub-delims, `:`, `@` and `/`.
 */
const NON_PATH_CHAR_REGEX = /[^\w\-.~!$&'()*+,;=:@/]/gu

/**
 * Requires the AWS Lambda Node.js runtime with response streaming enabled,
 * handlers should be wrapped with `awslambda.streamifyResponse`.
 */
export class AwsLambdaHandler<T extends Context> {
  private readonly sendStandardResponseOptions: AwsLambdaHandlerOptions<T>['sendStandardResponse']
  private readonly pathEncoding: Exclude<AwsLambdaHandlerOptions<T>['pathEncoding'], undefined>

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<AwsLambdaHandlerOptions<T>> = {},
  ) {
    this.sendStandardResponseOptions = options.sendStandardResponse
    this.pathEncoding = options.pathEncoding ?? 'auto'
  }

  async handle(
    event: AnyAPIGatewayProxyEvent,
    responseStream: HttpResponseStream,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<AwsLambdaHandlerHandleResult> {
    const standardRequest = toStandardLazyRequest(this.escapeDecodedPath(event), responseStream)

    const result = await this.standardHandler.handle(
      standardRequest,
      resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest)),
    )

    if (!result.matched) {
      return result
    }

    await sendStandardResponse(responseStream, result.response, this.sendStandardResponseOptions)

    return result
  }

  /**
   * Re-escapes an already-decoded path so it is decoded only once,
   * since `toStandardLazyRequest` treats every path as encoded and leaves `%` as is.
   */
  private escapeDecodedPath(event: AnyAPIGatewayProxyEvent): AnyAPIGatewayProxyEvent {
    if (this.pathEncoding === 'encoded' || (this.pathEncoding === 'auto' && !isDecodedPathEvent(event))) {
      return event
    }

    if ('httpMethod' in event) {
      return { ...event, path: event.path.replace(NON_PATH_CHAR_REGEX, safeEncodeURIComponent) }
    }

    return { ...event, rawPath: event.rawPath.replace(NON_PATH_CHAR_REGEX, safeEncodeURIComponent) }
  }
}

/**
 * HTTP APIs deliver decoded paths, REST APIs, ALB and Lambda Function URLs deliver encoded ones.
 */
function isDecodedPathEvent(event: AnyAPIGatewayProxyEvent): boolean {
  if ('httpMethod' in event) {
    // only HTTP APIs set `version` in payload 1.0
    return (event as { version?: unknown }).version === '1.0'
  }

  const domainName = (event.requestContext as { domainName?: unknown }).domainName

  return typeof domainName !== 'string' || !FUNCTION_URL_DOMAIN_REGEX.test(domainName)
}
