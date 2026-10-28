import type { AnyORPCError } from '@orpc/client'
import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, Context } from '@orpc/server'
import type { StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from '@orpc/server/standard'
import type { Public, Value } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standard-server/core'
import { COMMON_ERROR_STATUS_MAP, ORPCError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS } from '@orpc/server'
import { RPCMatcher } from '@orpc/server/standard'
import { getOwn, isAsyncIteratorObject, pathToHttpPath, value } from '@orpc/shared'
import { cancelStandardBody } from '@standard-server/core'
import { encodeJsonRpcError } from '../../json-rpc'
import { isEventIteratorProcedure } from '../../utils'
import { getJsonRpcCall } from './utils'

export interface OpenRPCHandlerCodecOptions<_T extends Context> {
  /**
   * Filter which procedures are exposed as JSON-RPC methods. Excluded procedures answer "Method not found".
   * Procedures with an event iterator input or output are always excluded.
   *
   * @default true
   */
  filter?: Value<boolean, [procedure: AnyProcedureContract | AnyProcedure, path: string[]]> | undefined

  /**
   * Serializes results and error data into JSON the same way OpenAPI responses are.
   *
   * @default new OpenAPIJsonSerializer()
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined

  /**
   * Mapping ORPCError Code -> JSON-RPC error code. Codes missing from the map fall back to
   * `DEFAULT_JSON_RPC_ERROR_CODE` (-32000). Pass the same map to `OpenRPCGenerator`.
   *
   * @default COMMON_JSON_RPC_ERROR_CODE_MAP
   * @see {@link https://orpc.dev/docs/openrpc/handler#error-codes | OpenRPC Handler - Error Codes}
   */
  errorCodeMap?: Record<string, number> | undefined
}

/**
 * The codec of `OpenRPCHandler`. It only resolves the per-call sub-requests created by `OpenRPCEnvelopeHandlerPlugin`,
 * so use the two together.
 */
export class OpenRPCHandlerCodec<T extends Context> implements StandardHandlerCodec<T> {
  private readonly matcher: RPCMatcher
  private readonly serializer: Public<OpenAPIJsonSerializer>
  private readonly errorCodeMap: OpenRPCHandlerCodecOptions<T>['errorCodeMap']

  constructor(router: AnyRouter, options: OpenRPCHandlerCodecOptions<T> = {}) {
    const filter = options.filter ?? true

    this.matcher = new RPCMatcher(router, {
      allowMethods: ['POST'],
      filter: (procedure, path) => !isEventIteratorProcedure(procedure) && value(filter, procedure, path),
    })
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
    this.errorCodeMap = options.errorCodeMap
  }

  async resolveProcedure(request: StandardLazyRequest): Promise<StandardHandlerCodecResolvedProcedure | undefined> {
    const method = getJsonRpcCall(request)?.method
    const path = method?.split('.') ?? []

    // `rpc.*` names are reserved, and an empty segment would alias another path (`a.` -> `/a/` -> `/a`)
    if (!method || method.startsWith('rpc.') || path.includes('')) {
      return undefined
    }

    const matched = await this.matcher.match('POST', pathToHttpPath(path), undefined)

    if (!matched) {
      return undefined
    }

    return {
      ...matched,
      decodeInput: async () => decodeParams(await request.resolveBody(), matched.procedure),
    }
  }

  async encodeOutput(output: unknown, _procedure: AnyProcedure, path: string[]): Promise<StandardResponse> {
    if (output instanceof ReadableStream || isAsyncIteratorObject(output)) {
      await cancelStandardBody(output).catch(() => {})
      throw new TypeError(`[OpenRPCHandler] Procedure "${path.join('.')}" returned a stream, which JSON-RPC cannot send.`)
    }

    const { json, blobs } = this.serializer.serializeJson(output)

    // `JSON.stringify` drops functions and symbols, which would leave the response without its required `result`
    if (blobs?.length || typeof json === 'function' || typeof json === 'symbol') {
      throw new TypeError(`[OpenRPCHandler] Procedure "${path.join('.')}" returned a value JSON-RPC cannot send.`)
    }

    // `undefined` serializes to `null`
    return { status: 200, headers: {}, body: { result: json } }
  }

  encodeError(error: AnyORPCError): StandardResponse {
    return {
      // the status the per-call plugins (such as rate limiting) see, the HTTP status of JSON-RPC errors is always 200
      status: getOwn(COMMON_ERROR_STATUS_MAP, error.code) ?? DEFAULT_ERROR_STATUS,
      headers: {},
      body: { error: encodeJsonRpcError(error, this.serializer, this.errorCodeMap) },
    }
  }
}

/**
 * `[x]` is `x` (by-position), a non-empty object is the input itself (by-name), and empty params
 * (absent, `[]`, or `{}`) are whichever of `undefined` or `{}` the input schemas accept,
 * since generic clients send any of them for methods without required params.
 */
async function decodeParams(params: unknown, procedure: AnyProcedure): Promise<unknown> {
  if (Array.isArray(params)) {
    if (params.length > 1) {
      throw new ORPCError('BAD_REQUEST', {
        message: `Invalid params: expected at most 1 positional parameter, received ${params.length}.`,
      })
    }

    if (params.length === 1) {
      return params[0]
    }
  }
  else if (params !== undefined && Object.keys(params as object).length > 0) {
    return params
  }

  const accepts = await acceptsEmptyInputs(procedure)

  if (params === undefined || Array.isArray(params)) {
    return accepts.undefined || !accepts.object ? undefined : {}
  }

  return accepts.object || !accepts.undefined ? {} : undefined
}

/**
 * Whether the input schemas accept `undefined` and `{}`, worked out once per procedure since it only depends on its schemas.
 */
const emptyInputsAcceptance = new WeakMap<AnyProcedure, Promise<{ undefined: boolean, object: boolean }>>()

function acceptsEmptyInputs(procedure: AnyProcedure): Promise<{ undefined: boolean, object: boolean }> {
  let accepts = emptyInputsAcceptance.get(procedure)

  if (!accepts) {
    accepts = Promise.all([acceptsInput(procedure, undefined), acceptsInput(procedure, {})])
      .then(([acceptsUndefined, acceptsObject]) => ({ undefined: acceptsUndefined, object: acceptsObject }))
    emptyInputsAcceptance.set(procedure, accepts)
  }

  return accepts
}

async function acceptsInput(procedure: AnyProcedure, input: unknown): Promise<boolean> {
  for (const schema of procedure['~orpc'].inputSchemas ?? []) {
    try {
      if ((await schema['~standard'].validate(input)).issues) {
        return false
      }
    }
    catch {
      return false
    }
  }

  return true
}
