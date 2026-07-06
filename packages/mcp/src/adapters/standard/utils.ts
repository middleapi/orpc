import type { StandardBody, StandardLazyRequest } from '@standardserver/core'
import type { JSONRPCIncoming } from '../../types'
import { JSONRPC_VERSION } from '../../constants'

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isValidIncoming(value: unknown): value is JSONRPCIncoming {
  if (!isObject(value) || value.jsonrpc !== JSONRPC_VERSION || typeof value.method !== 'string') {
    return false
  }
  // A JSON-RPC id, when present, must be a string or number (null/object/array
  // are invalid). A missing id marks a notification.
  return !('id' in value) || typeof value.id === 'string' || typeof value.id === 'number'
}

/**
 * Return a shallow copy of `request` whose body is already resolved to `body`.
 *
 * The request body stream can only be consumed once, but both the plugin and
 * the codec need the parsed JSON-RPC envelope. The plugin reads it once and
 * hands the codec a request with the parse baked in — so the single-read
 * guarantee travels with the request rather than depending on the request
 * instance staying identical across the pipeline (it may be replaced).
 */
export function withResolvedBody(request: StandardLazyRequest, body: unknown): StandardLazyRequest {
  return {
    ...request,
    resolveBody: () => Promise.resolve(body as StandardBody),
  }
}
