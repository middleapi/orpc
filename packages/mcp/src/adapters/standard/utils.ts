import type { StandardLazyRequest } from '@standardserver/core'
import type { JSONRPCIncoming } from '../../types'
import { JSONRPC_VERSION } from '../../constants'

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isValidIncoming(value: unknown): value is JSONRPCIncoming {
  return isObject(value) && value.jsonrpc === JSONRPC_VERSION && typeof value.method === 'string'
}

export function getMessageId(value: unknown): string | number | null {
  return isObject(value) && (typeof value.id === 'string' || typeof value.id === 'number') ? value.id : null
}

/**
 * The body stream can only be consumed once, but both the plugin and the codec
 * need the parsed JSON-RPC envelope. Memoize the parse per request so they share
 * a single read.
 */
const payloadCache = new WeakMap<StandardLazyRequest, Promise<unknown>>()

/**
 * Read + parse the JSON-RPC body of an MCP request (once per request).
 * The returned promise rejects if the body is not valid JSON.
 */
export function readMCPPayload(request: StandardLazyRequest): Promise<unknown> {
  let parsed = payloadCache.get(request)
  if (parsed === undefined) {
    parsed = request.resolveBody('json')
    payloadCache.set(request, parsed)
  }
  return parsed
}
