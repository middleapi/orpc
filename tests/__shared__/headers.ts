import { REQUEST_HEADERS_CONTEXT_SYMBOL, RESPONSE_HEADERS_CONTEXT_SYMBOL } from '@orpc/client'

/**
 * Matches `context` with the request and response headers that handlers and links inject into it.
 */
export function withHeaders<T extends object>(context: T): T {
  return {
    ...context,
    [REQUEST_HEADERS_CONTEXT_SYMBOL]: expect.any(Object),
    [RESPONSE_HEADERS_CONTEXT_SYMBOL]: expect.any(Object),
  }
}
