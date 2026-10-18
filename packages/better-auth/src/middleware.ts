import type { Context, Middleware, MiddlewareOptions } from '@orpc/server'
import type { Promisable, Value } from '@orpc/shared'
import type { BetterAuthContext, BetterAuthRequestState } from './context'
import { ORPCError } from '@orpc/server'
import { value } from '@orpc/shared'
import { getBetterAuthRequestState } from './context'

/**
 * The part of a Better Auth instance (the return value of `betterAuth()`) the session middlewares rely on.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#protected-procedures | Better Auth Integration - Protected Procedures}
 */
export interface BetterAuthInstance {
  api: {
    getSession: (context: { headers: Headers, returnHeaders: true }) => Promise<{ headers: Headers, response: unknown }>
  }
  $Infer: {
    Session: unknown
  }
}

/**
 * Session type of a Better Auth instance, `typeof auth.$Infer.Session`.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#protected-procedures | Better Auth Integration - Protected Procedures}
 */
export type InferBetterAuthSession<TAuth extends BetterAuthInstance> = TAuth['$Infer']['Session']

/**
 * Options of `requireSession` and `optionalSession`.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#protected-procedures | Better Auth Integration - Protected Procedures}
 */
export interface SessionMiddlewareOptions<
  TInContext extends Context,
  TInput,
  TAuth extends BetterAuthInstance,
> {
  /**
   * The Better Auth instance, or a function (optionally async) that returns it.
   * Session lookups are deduplicated per request by instance identity,
   * so return the same instance for every call to share one lookup.
   */
  auth: Value<Promisable<TAuth>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>
}

/**
 * Resolves the Better Auth session and adds it to the context as `session`.
 * Throws an `UNAUTHORIZED` error when the request has no valid session.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#protected-procedures | Better Auth Integration - Protected Procedures}
 */
export function requireSession<
  TInContext extends Context,
  TInput,
  TAuth extends BetterAuthInstance,
>(
  options: SessionMiddlewareOptions<TInContext, TInput, TAuth>,
): Middleware<TInContext, { session: InferBetterAuthSession<TAuth> }, TInput, any, Record<never, never>> {
  return async function requireSession(middlewareOptions, input) {
    const auth = await value(options.auth, middlewareOptions, input)
    const session = await lookupSession(getBetterAuthRequestState(middlewareOptions.context as BetterAuthContext), auth)

    if (session === null) {
      throw new ORPCError('UNAUTHORIZED')
    }

    return middlewareOptions.next({ context: { session } })
  }
}

/**
 * Resolves the Better Auth session and adds it to the context as `session`,
 * or `null` when the request has no valid session.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth#protected-procedures | Better Auth Integration - Protected Procedures}
 */
export function optionalSession<
  TInContext extends Context,
  TInput,
  TAuth extends BetterAuthInstance,
>(
  options: SessionMiddlewareOptions<TInContext, TInput, TAuth>,
): Middleware<TInContext, { session: InferBetterAuthSession<TAuth> | null }, TInput, any, Record<never, never>> {
  return async function optionalSession(middlewareOptions, input) {
    const auth = await value(options.auth, middlewareOptions, input)
    const session = await lookupSession(getBetterAuthRequestState(middlewareOptions.context as BetterAuthContext), auth)

    return middlewareOptions.next({ context: { session } })
  }
}

/**
 * Looks up the session once per request and `auth` instance,
 * collecting the `set-cookie` headers Better Auth returns (refreshed session and cookie cache).
 */
function lookupSession<TAuth extends BetterAuthInstance>(
  state: BetterAuthRequestState,
  auth: TAuth,
): Promise<InferBetterAuthSession<TAuth> | null> {
  let lookup = state.lookups.get(auth)

  if (!lookup) {
    lookup = auth.api.getSession({ headers: state.headers, returnHeaders: true }).then(({ headers, response }) => {
      state.setCookies.push(...headers.getSetCookie())
      return response
    })

    state.lookups.set(auth, lookup)
  }

  return lookup as Promise<InferBetterAuthSession<TAuth> | null>
}
