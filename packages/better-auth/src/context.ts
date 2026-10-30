import type { StandardHeaders } from '@standard-server/core'
import { toFetchHeaders } from '@standard-server/fetch'

/**
 * Context symbol under which the per-request Better Auth state is stored.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#server-side-calls | Better Auth Integration - Server-Side Calls}
 */
export const BETTER_AUTH_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_BETTER_AUTH_CONTEXT')

/**
 * Per-request state shared by the session middlewares and `BetterAuthHandlerPlugin`.
 * Batch subrequests share the same object, so session lookups and collected cookies span the whole HTTP request.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#server-side-calls | Better Auth Integration - Server-Side Calls}
 */
export interface BetterAuthRequestState {
  /**
   * Request headers passed to `auth.api.getSession`.
   */
  readonly headers: Headers

  /**
   * `set-cookie` values returned by session lookups, waiting to be applied to the response.
   */
  readonly setCookies: string[]

  /**
   * Pending or settled session lookups of this request, keyed by `auth` instance.
   */
  readonly lookups: WeakMap<object, Promise<unknown>>
}

/**
 * Context shape that carries the per-request Better Auth state.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#server-side-calls | Better Auth Integration - Server-Side Calls}
 */
export interface BetterAuthContext {
  [BETTER_AUTH_CONTEXT_SYMBOL]?: undefined | BetterAuthRequestState
}

export interface CreateBetterAuthContextOptions {
  /**
   * Headers of the incoming request, used to read the session cookie or bearer token.
   */
  headers: Headers | StandardHeaders
}

/**
 * Creates the context the session middlewares need when a procedure runs without `BetterAuthHandlerPlugin`,
 * e.g. in server-side calls, tests, or custom entrypoints.
 *
 * @remarks
 * **Note**: Without the plugin, `set-cookie` values from session lookups are collected in the returned state but not applied to any response.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#server-side-calls | Better Auth Integration - Server-Side Calls}
 */
export function createBetterAuthContext(options: CreateBetterAuthContextOptions): Required<BetterAuthContext> {
  const headers = options.headers
  return {
    [BETTER_AUTH_CONTEXT_SYMBOL]: createBetterAuthRequestState(
      () => headers instanceof Headers ? headers : toFetchHeaders(headers),
    ),
  }
}

/**
 * Creates a request state whose headers are resolved lazily, on the first session lookup.
 */
export function createBetterAuthRequestState(getHeaders: () => Headers): BetterAuthRequestState {
  let headers: Headers | undefined

  return {
    get headers() {
      headers ??= getHeaders()
      return headers
    },
    setCookies: [],
    lookups: new WeakMap(),
  }
}

/**
 * Retrieves the per-request Better Auth state from the oRPC context.
 *
 * @throws Error when neither `BetterAuthHandlerPlugin` nor `createBetterAuthContext` provided the state.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#server-side-calls | Better Auth Integration - Server-Side Calls}
 */
export function getBetterAuthRequestState(context: BetterAuthContext): BetterAuthRequestState {
  const state = context[BETTER_AUTH_CONTEXT_SYMBOL]

  if (!state) {
    throw new Error(
      '[@orpc/better-auth] Request headers are not available in the context. '
      + 'Add `BetterAuthHandlerPlugin` to your handler plugins, '
      + 'or pass `createBetterAuthContext({ headers })` as the context for server-side calls.',
    )
  }

  return state
}
