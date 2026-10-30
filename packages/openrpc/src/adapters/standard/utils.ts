import type { StandardLazyRequest } from '@standard-server/core'
import type { JsonRpcId } from '../../json-rpc'
import { flattenStandardHeader } from '@standard-server/core'

/**
 * The JSON-RPC call a per-call sub-request represents.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#interceptors | OpenRPC Handler - Interceptors}
 */
export interface JsonRpcCall {
  method: string
  /**
   * `undefined` for notifications, which are never answered.
   */
  id: JsonRpcId | undefined
}

/**
 * Marks the sub-requests `StandardOpenRPCHandler` creates, one per JSON-RPC call. The codec only resolves marked
 * requests, so a raw HTTP request (whose body or headers cannot carry a symbol) never routes to a procedure.
 */
export const JSON_RPC_CALL_SYMBOL: unique symbol = Symbol.for('ORPC_JSON_RPC_CALL')

/**
 * Returns the JSON-RPC call a sub-request represents, or `undefined` for any other request,
 * such as the HTTP request routing interceptors see.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#interceptors | OpenRPC Handler - Interceptors}
 */
export function getJsonRpcCall(request: StandardLazyRequest): JsonRpcCall | undefined {
  return (request as { [JSON_RPC_CALL_SYMBOL]?: JsonRpcCall })[JSON_RPC_CALL_SYMBOL]
}

/**
 * None of these is CORS-safelisted, so a cross-site request always needs a preflight (CSRF protection).
 */
const JSON_RPC_MEDIA_TYPES = new Set(['application/json', 'application/json-rpc', 'application/jsonrequest'])

export function isJsonRpcMediaType(contentType: string | readonly string[] | undefined): boolean {
  return JSON_RPC_MEDIA_TYPES.has(flattenStandardHeader(contentType)?.split(';')[0]?.trim().toLowerCase() ?? '')
}
