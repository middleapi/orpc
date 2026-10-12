import type { AnyORPCError } from '@orpc/client'
import type { AnyProcedure, AnyRouter, Context } from '@orpc/server'
import type { ResolvedStandardHandlerHandleOptions, StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from '@orpc/server/standard'
import type { Promisable, Public } from '@orpc/shared'
import type { StandardBody, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { OpenAPIMeta } from '../../meta'
import type { OpenAPIMatcherOptions } from './openapi-matcher'
import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { DEFAULT_ERROR_STATUS, DEFAULT_SUCCESS_STATUS } from '@orpc/server'
import { getOwn, isPlainObject, isTypescriptObject, NullProtoObj, parseEmptyableJSON, stringifyJSON } from '@orpc/shared'
import { parseStandardUrl } from '@standard-server/core'
import {
  DEFAULT_OPENAPI_INPUT_STRUCTURE,
  DEFAULT_OPENAPI_OUTPUT_STRUCTURE,
} from '../../constants'
import { getOpenAPIMeta } from '../../meta'
import { OpenAPISerializer } from '../../openapi-serializer'
import { isBodylessMethod } from '../../utils'
import { OpenAPIMatcher } from './openapi-matcher'
import { serializeHeaders } from './utils'

export interface OpenAPIHandlerCodecCoreOptions<_T extends Context> {
  /**
   * Override the default OpenAPI serializer.
   */
  serializer?: Public<OpenAPISerializer>

  /**
   * Mapping ORPCError Code -> HTTP Status Code
   * The status code should be in the `4xx` or `5xx` range (must be greater than or equal to `400`).
   *
   * @default COMMON_ERROR_STATUS_MAP
   */
  errorStatusMap?: Record<string, number> | undefined

  /**
   * Customize how an ORPC error is serialized into a response body.
   * Use this if your API needs a different error output structure.
   *
   * @remarks
   * - Return `null | undefined` to fallback to default behavior
   *
   * @default ((e) => e.toJSON())
   */
  customErrorResponseBodyEncoder?: (error: AnyORPCError) => unknown
}

export class OpenAPIHandlerCodecCore<T extends Context> {
  private readonly serializer: Public<OpenAPISerializer>
  private readonly errorStatusMap: Exclude<OpenAPIHandlerCodecOptions<T>['errorStatusMap'], undefined>
  private readonly customErrorResponseBodySerializer: OpenAPIHandlerCodecOptions<T>['customErrorResponseBodyEncoder']

  constructor(options: OpenAPIHandlerCodecCoreOptions<T> = {}) {
    this.serializer = options.serializer ?? new OpenAPISerializer()
    this.errorStatusMap = options.errorStatusMap ?? COMMON_ERROR_STATUS_MAP
    this.customErrorResponseBodySerializer = options.customErrorResponseBodyEncoder
  }

  async decodeInput(
    matched: { procedure: AnyProcedure, params?: undefined | Record<string, string> },
    request: StandardLazyRequest,
  ): Promise<unknown> {
    const meta = getOpenAPIMeta(matched.procedure)
    const inputStructure = meta?.inputStructure ?? DEFAULT_OPENAPI_INPUT_STRUCTURE
    const params = this.deserializeParams(matched.params, meta?.paramsStyles)

    if (inputStructure === 'compact') {
      const data = isBodylessMethod(request.method)
        ? this.deserializeQuery(request.url, meta?.queryStyles)
        : this.serializer.deserialize(await request.resolveBody(meta?.requestBodyHint))

      if (data === undefined) {
        return params
      }

      if (!params || Object.keys(params).length < 1) {
        return data
      }

      // Non-object data (primitive, array, Blob, ReadableStream, ...) cannot be merged with params.
      // Prefer params to stay consistent with the OpenAPI generator, which only describes path params here.
      if (!isPlainObject(data)) {
        return params
      }

      return {
        ...data,
        ...params,
      }
    }

    return {
      params,
      query: this.deserializeQuery(request.url, meta?.queryStyles),
      headers: request.headers,
      body: this.serializer.deserialize(await request.resolveBody(meta?.requestBodyHint)),
    }
  }

  /**
   * @throws {TypeError} If `outputStructure` is "detailed" and the output doesn't match the expected structure.
   * @throws {TypeError} If the response status is not an integer in the 200-399 range, or is 204, 205 or 304 with a body.
   */
  encodeOutput(output: unknown, procedure: AnyProcedure, path: string[]): Promisable<StandardResponse> {
    const meta = getOpenAPIMeta(procedure)
    const successStatus = meta?.successStatus ?? DEFAULT_SUCCESS_STATUS
    const outputStructure = meta?.outputStructure ?? DEFAULT_OPENAPI_OUTPUT_STRUCTURE

    if (outputStructure === 'compact') {
      const body = this.serializer.serialize(output)

      assertSendableSuccessResponse(successStatus, body, path)

      return {
        status: successStatus,
        headers: {},
        body,
      }
    }

    if (!isValidDetailedOutput(output)) {
      throw new TypeError(`
        Invalid "detailed" output structure returned by procedure (${path.join('.')}):
        • Expected an object with optional properties:
          - status (integer 200-399)
          - headers (object)
          - body (any)
        • No extra keys allowed.

        Actual value:
          ${stringifyJSON(output)}
      `)
    }

    const status = output.status ?? successStatus
    const headers = output.headers !== undefined ? serializeHeaders(output.headers, this.serializer) : {}
    const body = this.serializer.serialize(output.body)

    assertSendableSuccessResponse(status, body, path)

    return {
      status,
      headers,
      body,
    }
  }

  encodeError(error: AnyORPCError): Promisable<StandardResponse> {
    const status = getOwn(this.errorStatusMap, error.code) ?? DEFAULT_ERROR_STATUS

    return {
      status,
      headers: {},
      body: this.serializer.serialize(this.customErrorResponseBodySerializer?.(error) ?? error.toJSON()),
    }
  }

  private deserializeQuery(
    url: StandardLazyRequest['url'],
    styles: OpenAPIMeta['queryStyles'],
  ): unknown {
    const [, search] = parseStandardUrl(url)
    const searchParams = new URLSearchParams(search)
    const parsed = this.serializer.deserialize(searchParams)

    if (!styles || !isPlainObject(parsed)) {
      return parsed
    }

    Object.entries(styles).forEach(([key, hint]) => {
      if (hint === undefined) {
        return
      }

      const values = searchParams.getAll(key)
      let parsedValue: unknown

      if (hint === 'primitive') {
        parsedValue = values.at(-1)
      }

      else if (hint === 'array') {
        parsedValue = values
      }

      else if (hint === 'comma-delimited-array') {
        parsedValue = decodeDelimitedArray(values.at(-1), ',')
      }

      else if (hint === 'comma-delimited-object') {
        parsedValue = decodeDelimitedObject(values.at(-1), ',')
      }

      else if (hint === 'space-delimited-array') {
        parsedValue = decodeDelimitedArray(values.at(-1), ' ')
      }

      else if (hint === 'space-delimited-object') {
        parsedValue = decodeDelimitedObject(values.at(-1), ' ')
      }

      else if (hint === 'pipe-delimited-array') {
        parsedValue = decodeDelimitedArray(values.at(-1), '|')
      }

      else if (hint === 'pipe-delimited-object') {
        parsedValue = decodeDelimitedObject(values.at(-1), '|')
      }

      else {
        const _expect: 'json' = hint

        const last = values.at(-1)

        try {
          parsedValue = parseEmptyableJSON(last)
        }
        catch {
          parsedValue = last
        }
      }

      parsed[key] = this.serializer.deserialize(parsedValue)
    })

    return parsed
  }

  private deserializeParams(
    params: Record<string, string> | undefined,
    styles: OpenAPIMeta['paramsStyles'],
  ): Record<string, unknown> | undefined {
    if (!params || !styles) {
      return params
    }

    const parsed: Record<string, unknown> = { ...params }

    Object.entries(styles).forEach(([key, hint]) => {
      const value = getOwn(params, key)

      if (hint === undefined || hint === 'primitive' || value === undefined) {
        return
      }

      if (hint === 'comma-delimited-array') {
        parsed[key] = decodeDelimitedArray(value, ',')
      }
      else {
        const _expect: 'comma-delimited-object' = hint

        parsed[key] = decodeDelimitedObject(value, ',')
      }
    })

    return parsed
  }
}

export interface OpenAPIHandlerCodecOptions<T extends Context>
  extends OpenAPIHandlerCodecCoreOptions<T>, OpenAPIMatcherOptions {}

export class OpenAPIHandlerCodec<T extends Context> extends OpenAPIHandlerCodecCore<T> implements StandardHandlerCodec<T> {
  private readonly matcher: OpenAPIMatcher

  constructor(router: AnyRouter, options: OpenAPIHandlerCodecOptions<T> = {}) {
    super(options)
    this.matcher = new OpenAPIMatcher(router, options)
  }

  async resolveProcedure(request: StandardLazyRequest, options: ResolvedStandardHandlerHandleOptions<T>): Promise<StandardHandlerCodecResolvedProcedure | undefined> {
    const [pathname] = parseStandardUrl(request.url)

    const matched = await this.matcher.match(request.method, pathname, options.prefix)

    if (!matched) {
      return undefined
    }

    return {
      procedure: matched.procedure,
      path: matched.path,
      decodeInput: () => this.decodeInput(matched, request),
    }
  }
}

function isValidDetailedOutput(output: unknown): output is { status?: number, body?: unknown, headers?: object } {
  if (!isTypescriptObject(output)) {
    return false
  }

  if (Object.keys(output).some(key => key !== 'status' && key !== 'headers' && key !== 'body')) {
    return false
  }

  if (output.status !== undefined && !isValidSuccessStatus(output.status)) {
    return false
  }

  if (output.headers !== undefined && !isTypescriptObject(output.headers)) {
    return false
  }

  return true
}

const BODYLESS_STATUSES = [204, 205, 304]

function isValidSuccessStatus(status: unknown): status is number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 200 && status <= 399
}

/**
 * Adapters cannot send every status a procedure may return (e.g. fetch `Response` rejects statuses below 200
 * and a body on 204, 205 and 304), so reject them while encoding, where the error becomes a 500 response.
 *
 * @throws {TypeError} If the status is not an integer in the 200-399 range, or cannot carry the given body.
 */
function assertSendableSuccessResponse(status: number, body: StandardBody, path: string[]): void {
  if (!isValidSuccessStatus(status)) {
    throw new TypeError(`
      Invalid success status (${status}) for procedure (${path.join('.')}):
      • Expected an integer in the 200-399 range. Check the "successStatus" meta.
    `)
  }

  if (body !== undefined && BODYLESS_STATUSES.includes(status)) {
    throw new TypeError(`
      Invalid success response returned by procedure (${path.join('.')}):
      • HTTP status ${status} cannot have a body, but the output has one.
      • Return \`undefined\` as the body, or use a status that allows a body.
    `)
  }
}

function decodeDelimitedArray(value: string | undefined, delimiter: string): undefined | string[] {
  if (value === undefined) {
    return undefined
  }

  return value.split(delimiter)
}

function decodeDelimitedObject(value: string | undefined, delimiter: string): undefined | Record<string, unknown> {
  if (value === undefined) {
    return undefined
  }

  const obj = new NullProtoObj() // Prevent Prototype Pollution with NullProtoObj
  const parts = value.split(delimiter)

  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i]!
    obj[key] = parts[i + 1]
  }

  return obj
}
