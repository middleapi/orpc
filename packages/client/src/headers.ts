/**
 * Context symbol under which oRPC stores the request headers as a `Headers` instance.
 *
 * - In handlers, it holds the headers of the incoming request.
 * - In links, its headers are added to the outgoing request.
 *
 * @see {@link https://orpc.dev/docs/headers | Headers}
 */
export const REQUEST_HEADERS_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_REQUEST_HEADERS_CONTEXT')

/**
 * Context symbol under which oRPC stores the response headers as a `Headers` instance.
 *
 * - In handlers, its headers are added to the outgoing response.
 * - In links, it receives the headers of the incoming response.
 *
 * @see {@link https://orpc.dev/docs/headers | Headers}
 */
export const RESPONSE_HEADERS_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_RESPONSE_HEADERS_CONTEXT')

/**
 * Context shape that carries the request and response headers injected by handlers and links.
 *
 * @see {@link https://orpc.dev/docs/headers | Headers}
 */
export interface HeadersContext {
  [REQUEST_HEADERS_CONTEXT_SYMBOL]?: Headers | undefined
  [RESPONSE_HEADERS_CONTEXT_SYMBOL]?: Headers | undefined
}

/**
 * Retrieves the request headers from the oRPC context, if available.
 *
 * Handlers inject the headers of the incoming request, links send the headers set on it.
 * Returns `undefined` when nothing provides them, such as in a server-side call without them.
 *
 * @see {@link https://orpc.dev/docs/headers | Headers}
 */
export function getRequestHeaders(context: object): Headers | undefined {
  return (context as HeadersContext)[REQUEST_HEADERS_CONTEXT_SYMBOL]
}

/**
 * Retrieves the response headers from the oRPC context, if available.
 *
 * Handlers send the headers set on it, links fill it with the headers of the incoming response.
 * Returns `undefined` when nothing provides them, such as in a server-side call without them.
 *
 * @see {@link https://orpc.dev/docs/headers | Headers}
 */
export function getResponseHeaders(context: object): Headers | undefined {
  return (context as HeadersContext)[RESPONSE_HEADERS_CONTEXT_SYMBOL]
}
