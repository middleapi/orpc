export const ORPC_CLIENT_PACKAGE_NAME = '__ORPC_CLIENT_PACKAGE_NAME_PLACEHOLDER__'
export const ORPC_CLIENT_PACKAGE_VERSION = '__ORPC_CLIENT_PACKAGE_VERSION_PLACEHOLDER__'

/**
 * Property names that should resolve to the underlying value instead of
 * continuing recursive proxy traversal.
 *
 * These properties are commonly accessed automatically by JavaScript runtimes,
 * language features, or third-party libraries. Returning another recursive
 * proxy for them can cause unexpected behavior, compatibility issues, or
 * infinite proxy chains.
 *
 * Unlike v2, `then` is not included here because v1 supports procedures
 * named `then` and relies on `preventNativeAwait` to keep `await client` safe.
 */
export const RECURSIVE_CLIENT_UNWRAP_KEYS = new Set([
  /**
   * Commonly used by libraries to bind functions to a specific `this`
   * context.
   */
  'bind',
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
