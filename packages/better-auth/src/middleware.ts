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

/**
 * How long, in milliseconds, a finished lookup stays cached on `reqHeaders`.
 * Short on purpose: it only dedupes lookups that run together, such as chained middlewares,
 * and a long-lived `reqHeaders` never serves a stale session.
 */
const SESSION_CACHE_TTL = 10

interface SessionCache {
  auth: BetterAuthInstance
  promise: Promise<unknown>
  /**
   * When the lookup finished, `undefined` while it is pending.
   */
  settledAt: number | undefined
}

interface SessionCachedHeaders extends Headers {
  [SESSION_CACHE_SYMBOL]?: SessionCache | undefined
}

/**
 * Looks up the session, caching the lookup on `reqHeaders`: a pending lookup is shared,
 * and a finished one is reused for `SESSION_CACHE_TTL` milliseconds.
 * The `set-cookie` headers Better Auth returns (refreshed session, cookie cache) are appended to `resHeaders`.
 */
function getSession<TAuth extends BetterAuthInstance>(
  auth: TAuth,
  context: BetterAuthContext,
): Promise<InferBetterAuthSession<TAuth> | null> {
  const reqHeaders: SessionCachedHeaders | undefined = context.reqHeaders

  /**
   * Without request headers there is no cookie or token to read, so the request is not authenticated.
   */
  if (!reqHeaders) {
    return Promise.resolve(null)
  }

  const cached = reqHeaders[SESSION_CACHE_SYMBOL]

  if (
    cached?.auth === auth
    && (cached.settledAt === undefined || Date.now() - cached.settledAt < SESSION_CACHE_TTL)
  ) {
    return cached.promise as Promise<InferBetterAuthSession<TAuth> | null>
  }

  const cache: SessionCache = {
    auth,
    settledAt: undefined,
    promise: auth.api.getSession({ headers: reqHeaders, returnHeaders: true })
      .then(({ headers, response }) => {
        for (const cookie of headers.getSetCookie()) {
          context.resHeaders?.append('set-cookie', cookie)
        }

        return response
      })
      .finally(() => {
        cache.settledAt = Date.now()
      }),
  }

  reqHeaders[SESSION_CACHE_SYMBOL] = cache

  return cache.promise as Promise<InferBetterAuthSession<TAuth> | null>
}
