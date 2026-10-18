import type { AnyORPCError } from '@orpc/client'
import type { Promisable, Public, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { Context } from '../../context'
import type { AnyProcedure } from '../../procedure'
import type { AnyRouter } from '../../router'
import type { ResolvedStandardHandlerHandleOptions, StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from '../standard'
import type { RPCMatcherOptions } from './rpc-matcher'
import { COMMON_ERROR_STATUS_MAP, ORPCError, RPC_PROTOCOL_HEADER, RPCSerializer } from '@orpc/client'
import { getOwn, parseEmptyableJSON, value } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standard-server/core'
import { DEFAULT_ERROR_STATUS, DEFAULT_SUCCESS_STATUS } from '../../constants'
import { RPCMatcher } from './rpc-matcher'

export interface RPCHandlerCodecOptions<T extends Context> extends RPCMatcherOptions {
  /**
   * Override the default RPC serializer.
   */
  serializer?: Public<RPCSerializer>

  /**
   * Resolve HTTP status for encoded successful outputs.
   *
   * Value should be in the `2xx` range and must be less than `400`.
   * Return `undefined` or `null` to fallback to default
   *
   * @default DEFAULT_SUCCESS_STATUS (200)
   */
  outputStatus?: Value<number | undefined | null, [output: unknown, procedure: AnyProcedure, path: string[], options: ResolvedStandardHandlerHandleOptions<T>]>

  /**
   * Mapping ORPCError Code -> HTTP Status Code
   * The status code should be in the `4xx` or `5xx` range (must be greater than or equal to `400`).
   *
   * @default COMMON_ERROR_STATUS_MAP
   */
  errorStatusMap?: Record<string, number> | undefined

  /**
   * Rejects requests that a browser can send from another site without a CORS preflight,
   * such as an HTML form, with a `403` before their input is decoded. This covers requests
   * that read input from the body and have no `Content-Type` or a form or text one
   * (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`), unless they
   * carry the `orpc-protocol` header that RPC Link sends or the browser marks them
   * `Sec-Fetch-Site: same-origin`. `GET` requests are not covered.
   *
   * Pass a function to decide per request. It only runs for requests that would be rejected,
   * so return `false` to let one through.
   *
   * @default true
   * @see {@link https://orpc.dev/docs/rpc/handler#csrf-protection | RPC Handler - CSRF Protection}
   */
  csrfProtection?: Value<boolean, [request: StandardLazyRequest, procedure: AnyProcedure, path: string[]]>
}

/**
 * `Content-Type` essences browsers can send to another origin without a CORS preflight.
 *
 * @see {@link https://fetch.spec.whatwg.org/#cors-safelisted-request-header | Fetch - CORS-safelisted request-header}
 */
const CORS_SAFELISTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
])

/**
 * Whether a browser may have sent the request from another site, with the user's cookies
 * attached, without a CORS preflight giving the server a say first.
 */
function isCsrfExposedRequest(headers: StandardHeaders): boolean {
  // Browsers send a header outside the CORS safelist cross-origin only after a preflight.
  if (flattenStandardHeader(headers[RPC_PROTOCOL_HEADER]) !== undefined) {
    return false
  }

  // Set by browsers, which pages cannot override. It is absent over plain HTTP, in older
  // browsers, and from non-browser clients, so it can only exempt requests, never block them.
  if (flattenStandardHeader(headers['sec-fetch-site'])?.toLowerCase() === 'same-origin') {
    return false
  }

  // Parsed like the body parser does, so every value browsers safelist lands in the set.
  const mimeType = flattenStandardHeader(headers['content-type'])?.split(';')[0]!.trim().toLowerCase()

  return !mimeType || CORS_SAFELISTED_CONTENT_TYPES.has(mimeType)
}

export class RPCHandlerCodec<T extends Context> implements StandardHandlerCodec<T> {
  private readonly matcher: RPCMatcher
  private readonly serializer: Public<RPCSerializer>
  private readonly errorStatusMap: Exclude<RPCHandlerCodecOptions<T>['errorStatusMap'], undefined>
  private readonly outputStatus: RPCHandlerCodecOptions<T>['outputStatus']
  private readonly csrfProtection: Exclude<RPCHandlerCodecOptions<T>['csrfProtection'], undefined>

  constructor(router: AnyRouter, options: RPCHandlerCodecOptions<T> = {}) {
    this.matcher = new RPCMatcher(router, options)
    this.serializer = options.serializer ?? new RPCSerializer()
    this.errorStatusMap = options.errorStatusMap ?? COMMON_ERROR_STATUS_MAP
    this.outputStatus = options.outputStatus
    this.csrfProtection = options.csrfProtection ?? true
  }

  async resolveProcedure(request: StandardLazyRequest, options: ResolvedStandardHandlerHandleOptions<T>): Promise<StandardHandlerCodecResolvedProcedure | undefined> {
    const [pathname, query] = parseStandardUrl(request.url)

    const matched = await this.matcher.match(request.method, pathname, options.prefix)
    if (!matched) {
      return undefined
    }

    return {
      procedure: matched.procedure,
      path: matched.path,
      decodeInput: async () => {
        if (request.method === 'GET') {
          const dataString = (new URLSearchParams(query)).getAll('data').at(-1)
          return this.serializer.deserialize(parseEmptyableJSON(dataString))
        }

        // Checked before the body is read, so a rejected request is never parsed.
        if (isCsrfExposedRequest(request.headers) && value(this.csrfProtection, request, matched.procedure, matched.path)) {
          throw new ORPCError('FORBIDDEN', {
            message: `Request blocked by CSRF protection. Send the '${RPC_PROTOCOL_HEADER}' header, or a Content-Type other than a form or text one, such as 'application/json'.`,
          })
        }

        const body = await request.resolveBody()
        return this.serializer.deserialize(body)
      },
    }
  }

  encodeOutput(output: unknown, procedure: AnyProcedure, path: string[], options: ResolvedStandardHandlerHandleOptions<T>): Promisable<StandardResponse> {
    return {
      headers: {},
      status: value(this.outputStatus, output, procedure, path, options) ?? DEFAULT_SUCCESS_STATUS,
      body: this.serializer.serialize(output),
    }
  }

  encodeError(error: AnyORPCError, _procedure: AnyProcedure, _path: string[], _options: ResolvedStandardHandlerHandleOptions<T>): Promisable<StandardResponse> {
    const status = getOwn(this.errorStatusMap, error.code) ?? DEFAULT_ERROR_STATUS

    return {
      headers: {},
      status,
      body: this.serializer.serialize(error.toJSON()),
    }
  }
}
