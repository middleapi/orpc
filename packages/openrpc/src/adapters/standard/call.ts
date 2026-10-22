import type { StandardLazyRequest } from '@standard-server/core'
import type { JsonRpcId } from '../../json-rpc'

/**
 * The JSON-RPC call a per-call sub-request represents.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#interceptors | OpenRPC Handler - Interceptors}
 */
export interface JsonRpcCall {
  /**
   * The `method` member as received.
   */
  method: string

  /**
   * The `id` member, or `undefined` for notifications.
   */
  id: JsonRpcId | undefined

  /**
   * Whether the call is a notification (no `id` member), which is never answered.
   */
  notification: boolean

  /**
   * Whether the call is part of a batch request.
   */
  batch: boolean
}

/**
 * Marks the sub-requests the envelope plugin creates, one per JSON-RPC call.
 * The codec only resolves marked requests, so a raw HTTP request can never route to a procedure.
 *
 * It is an own enumerable property, so it survives `{ ...request, headers }` spreads in interceptors.
 *
 * @internal
 */
export const JSON_RPC_CALL_SYMBOL: unique symbol = Symbol('ORPC_JSON_RPC_CALL')

/**
 * A {@link StandardLazyRequest} marked as a JSON-RPC call.
 *
 * @internal
 */
export interface JsonRpcCallRequest extends StandardLazyRequest {
  [JSON_RPC_CALL_SYMBOL]: JsonRpcCall
}

/**
 * Returns the JSON-RPC call a sub-request represents, or `undefined` for any other request,
 * such as the raw HTTP request seen by plugins outside the envelope.
 *
 * @see {@link https://orpc.dev/docs/openrpc/handler#interceptors | OpenRPC Handler - Interceptors}
 */
export function getJsonRpcCall(request: StandardLazyRequest): JsonRpcCall | undefined {
  return (request as Partial<JsonRpcCallRequest>)[JSON_RPC_CALL_SYMBOL]
}
