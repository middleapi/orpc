/**
 * Property names that should resolve to the underlying value instead of
 * continuing recursive proxy traversal.
 *
 * These properties are commonly accessed automatically by JavaScript runtimes,
 * language features, or third-party libraries. Returning another recursive
 * proxy for them can cause unexpected behavior, compatibility issues, or
 * infinite proxy chains.
 */
export const RECURSIVE_CLIENT_UNWRAP_KEYS = new Set([
  /**
   * Prevents the client from being treated as a thenable when users
   * accidentally write `await client`.
   */
  'then',
  /**
   * Commonly used by libraries to bind functions to a specific `this`
   * context.
   */
  'bind',
  /**
   * Commonly used by libraries to invoke functions with a specific `this`
   * context.
   */
  'call',
  /**
   * Commonly used by libraries to invoke functions with a specific `this`
   * context and an arguments array.
   */
  'apply',
  /**
   * Commonly accessed during primitive conversion, inspection, and logging.
   */
  'valueOf',
  /**
   * Commonly accessed during string conversion, inspection, and logging.
   */
  'toString',
  /**
   * Commonly accessed by serializers such as `JSON.stringify`.
   */
  'toJSON',
])

/**
 * Request header that RPC Link sends with every request that carries input in its body.
 * Browsers send a header outside the CORS safelist to another origin only after a CORS
 * preflight approves it, so its presence proves a form, text, or body-less request is not
 * a cross-site HTML form or another request a page can send without a preflight.
 * RPC Handler rejects those requests without it, unless they come from the same origin.
 *
 * @see {@link https://orpc.dev/docs/rpc/handler#csrf-protection | RPC Handler - CSRF Protection}
 */
export const RPC_PROTOCOL_HEADER = 'orpc-protocol'
