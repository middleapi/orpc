import type { AnyORPCError } from '@orpc/client'
import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, Context } from '@orpc/server'
import type { StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from '@orpc/server/standard'
import type { Public, Value } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { JsonRpcErrorObject } from '../../json-rpc'
import type { EncodedJsonRpcError } from './utils'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_SUCCESS_STATUS } from '@orpc/server'
import { RPCMatcher } from '@orpc/server/standard'
import { pathToHttpPath, value } from '@orpc/shared'
import { isEventIteratorProcedure, toProcedurePath } from '../../utils'
import { getJsonRpcCall } from './call'
import { decodeJsonRpcParams } from './params'
import { cancelQuietly, createJsonRpcErrorEncoder, getUnsupportedValueKind, isJsonMemberValue } from './utils'

export interface OpenRPCHandlerCodecOptions<_T extends Context> {
  /**
   * Filter which procedures are exposed as JSON-RPC methods. Return `false` to exclude a procedure,
   * which then answers "Method not found". Pass the same filter to `OpenRPCGenerator`.
   *
   * @remarks
   * **Note**: Procedures with an event iterator input or output are always excluded,
   * since JSON-RPC over HTTP cannot stream.
   *
   * @default true
   * @see {@link https://orpc.dev/docs/openrpc/handler#filtering-procedures | OpenRPC Handler - Filtering Procedures}
   */
  filter?: Value<boolean, [procedure: AnyProcedureContract | AnyProcedure, path: string[]]> | undefined

  /**
   * Serializes results and error data into JSON, converting types such as `Date`, `BigInt`, and `Set`
   * the same way OpenAPI responses do.
   *
   * @default new OpenAPIJsonSerializer()
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined

  /**
   * Mapping ORPCError Code -> JSON-RPC error code (an integer).
   * A given map replaces the default one, and codes missing from it fall back to `DEFAULT_JSON_RPC_ERROR_CODE` (-32000).
   * Pass the same map to `OpenRPCGenerator`.
   *
   * @default COMMON_JSON_RPC_ERROR_CODE_MAP
   * @see {@link https://orpc.dev/docs/openrpc/protocol#error-codes | JSON-RPC Protocol - Error Codes}
   */
  errorCodeMap?: Record<string, number> | undefined

  /**
   * Mapping ORPCError Code -> HTTP Status Code of the per-call response, which inner plugins
   * (such as the rate limit plugin) see. It only becomes the HTTP status with `errorResponseStatus: 'mapped'`.
   * Codes missing from the map fall back to `DEFAULT_ERROR_STATUS` (400).
   *
   * @default COMMON_ERROR_STATUS_MAP
   * @see {@link https://orpc.dev/docs/openrpc/handler#http-status-codes | OpenRPC Handler - HTTP Status Codes}
   */
  errorStatusMap?: Record<string, number> | undefined

  /**
   * Customize the JSON-RPC error object built for an ORPCError.
   *
   * @remarks
   * - Return `null | undefined` to fallback to default behavior
   * - Must return a valid JSON-RPC error object (integer `code`, string `message`) and must not throw
   *
   * @default `{ code: errorCodeMap[error.code], message: error.message, data: { code, defined, data } }`
   * @see {@link https://orpc.dev/docs/openrpc/handler#custom-error-response | OpenRPC Handler - Custom Error Response}
   */
  customErrorEncoder?: ((error: AnyORPCError) => JsonRpcErrorObject | null | undefined) | undefined
}

/**
 * The codec of `OpenRPCHandler`. It only resolves the per-call sub-requests created by
 * `OpenRPCEnvelopeHandlerPlugin`, never a raw HTTP request, so use the two together.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#custom-adapters | OpenRPC Handler - Custom Adapters}
 */
export class OpenRPCHandlerCodec<T extends Context> implements StandardHandlerCodec<T> {
  private readonly matcher: RPCMatcher
  private readonly serializer: Public<OpenAPIJsonSerializer>
  private readonly encodeJsonRpcError: (error: AnyORPCError) => EncodedJsonRpcError

  /**
   * @throws {TypeError} If an `errorCodeMap` value is not an integer.
   */
  constructor(router: AnyRouter, options: OpenRPCHandlerCodecOptions<T> = {}) {
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
    this.encodeJsonRpcError = createJsonRpcErrorEncoder({ ...options, serializer: this.serializer }, 'OpenRPCHandlerCodec')

    const filter = options.filter ?? true

    this.matcher = new RPCMatcher(router, {
      allowMethods: ['POST'],
      filter: (procedure, path) => !isEventIteratorProcedure(procedure) && value(filter, procedure, path),
    })
  }

  async resolveProcedure(request: StandardLazyRequest): Promise<StandardHandlerCodecResolvedProcedure | undefined> {
    const call = getJsonRpcCall(request)

    if (call === undefined) {
      return undefined
    }

    const path = toProcedurePath(call.method)

    if (path === undefined) {
      return undefined
    }

    const matched = await this.matcher.match('POST', pathToHttpPath(path), undefined)

    if (!matched) {
      return undefined
    }

    return {
      procedure: matched.procedure,
      path: matched.path,
      decodeInput: async () => decodeJsonRpcParams(await request.resolveBody(), matched.procedure),
    }
  }

  /**
   * @throws {TypeError} If the output is a stream, an event iterator, contains binary data, or serializes to a
   * function, a symbol, or `undefined`, which JSON-RPC cannot send.
   */
  async encodeOutput(output: unknown, _procedure: AnyProcedure, path: string[]): Promise<StandardResponse> {
    const kind = getUnsupportedValueKind(output)

    if (kind !== undefined) {
      await cancelQuietly(output)
      throw new TypeError(`[OpenRPCHandler] Procedure "${path.join('.')}" returned ${kind}, which JSON-RPC cannot send. Exclude it with the "filter" option.`)
    }

    const { json, maps, blobs } = this.serializer.serializeJson(output)

    if (blobs?.length) {
      const locations = maps.map(segments => segments.length ? `"${segments.join('.')}"` : 'the root').join(', ')

      throw new TypeError(`[OpenRPCHandler] Procedure "${path.join('.')}" returned a Blob at ${locations}, which JSON-RPC cannot send. Exclude it with the "filter" option.`)
    }

    // `undefined` serializes to `null`, but a function, a symbol, or a custom handler's `undefined` would be dropped
    // by `JSON.stringify`, leaving the response without its required `result` member
    if (!isJsonMemberValue(json)) {
      throw new TypeError(`[OpenRPCHandler] Procedure "${path.join('.')}" returned a result that serializes to ${typeof json}, which JSON-RPC cannot send.`)
    }

    return {
      status: DEFAULT_SUCCESS_STATUS,
      headers: {},
      body: { result: json },
    }
  }

  encodeError(error: AnyORPCError): StandardResponse {
    const encoded = this.encodeJsonRpcError(error)

    return {
      status: encoded.status,
      headers: {},
      body: { error: encoded.error },
    }
  }
}
