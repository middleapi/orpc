import type { Context, Middleware, MiddlewareOptions } from '@orpc/server'
import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import type { Promisable, Value } from '@orpc/shared'
import { ORPCError } from '@orpc/server'
import { value } from '@orpc/shared'

/**
 * The part of a Better Auth instance (the return value of `betterAuth()`) the session middlewares use.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
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
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
 */
export type InferBetterAuthSession<TAuth extends BetterAuthInstance> = TAuth['$Infer']['Session']

/**
 * The context the session middlewares read:
 * `reqHeaders` from the Request Headers Plugin, and `resHeaders` from the Response Headers Plugin.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
 */
export interface BetterAuthContext extends RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext {}

/**
 * Options of `requireSession` and `optionalSession`.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
 */
export interface SessionMiddlewareOptions<
  TInContext extends Context,
  TInput,
  TAuth extends BetterAuthInstance,
> {
  /**
   * The Better Auth instance, or a function (sync or async) that returns it.
   */
  auth: Value<Promisable<TAuth>, [options: MiddlewareOptions<TInContext, unknown, Record<never, never>>, input: TInput]>
}

/**
 * Adds the Better Auth session to the context as `session`,
 * or throws an `UNAUTHORIZED` error when the request has none.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
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
    const session = await getSession(auth, middlewareOptions.context)

    if (!session) {
      throw new ORPCError('UNAUTHORIZED')
    }

    return middlewareOptions.next({ context: { session } })
  }
}

/**
 * Adds the Better Auth session to the context as `session`,
 * or `null` when the request has none.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
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
    const session = await getSession(auth, middlewareOptions.context)

    return middlewareOptions.next({ context: { session } })
  }
}

const SESSION_CACHE_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for('ORPC_BETTER_AUTH_SESSION_CACHE')

interface SessionCachedHeaders extends Headers {
  [SESSION_CACHE_SYMBOL]?: WeakMap<BetterAuthInstance, Promise<unknown>>
}

/**
 * Looks up the session once per `reqHeaders` and auth instance, caching the lookup on `reqHeaders`.
 * The `set-cookie` headers Better Auth returns (refreshed session, cookie cache) are appended to `resHeaders`.
 */
function getSession<TAuth extends BetterAuthInstance>(
  auth: TAuth,
  context: BetterAuthContext,
): Promise<InferBetterAuthSession<TAuth> | null> {
  const reqHeaders: SessionCachedHeaders | undefined = context.reqHeaders

  if (!reqHeaders) {
    throw new Error(
      '[@orpc/better-auth] `reqHeaders` is missing from the context. '
      + 'Add `RequestHeadersHandlerPlugin` to your handler, or pass `reqHeaders` in the context of server-side calls.',
    )
  }

  const cache = reqHeaders[SESSION_CACHE_SYMBOL] ??= new WeakMap()
  let session = cache.get(auth)

  if (!session) {
    session = auth.api.getSession({ headers: reqHeaders, returnHeaders: true }).then(({ headers, response }) => {
      for (const cookie of headers.getSetCookie()) {
        context.resHeaders?.append('set-cookie', cookie)
      }

      return response
    })

    cache.set(auth, session)
  }

  return session as Promise<InferBetterAuthSession<TAuth> | null>
}
