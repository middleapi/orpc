import type { Context, Middleware, MiddlewareOptions } from '@orpc/server'
import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import type { Promisable, Value } from '@orpc/shared'
import { ORPCError } from '@orpc/server'
import { stringifyJSON, value } from '@orpc/shared'

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

  /**
   * If the session middlewares run more than once for the same request,
   * such as chained middlewares or a procedure that calls another one with the same context,
   * this option ensures the session is looked up only once per request and auth instance.
   *
   * @default true
   */
  dedupe?: boolean | undefined
}

/**
 * Adds the Better Auth session to the context as `session`,
 * or throws an `UNAUTHORIZED` error when the request has none.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | Better Auth Integration}
 */
export function requireSession<
  TInContext extends Context & RequestHeadersHandlerPluginContext & ResponseHeadersHandlerPluginContext,
  TInput,
  TAuth extends BetterAuthInstance,
>(
  { dedupe = true, ...options }: SessionMiddlewareOptions<TInContext, TInput, TAuth>,
): Middleware<TInContext, { session: InferBetterAuthSession<TAuth> }, TInput, any, Record<never, never>> {
  return async function requireSession(middlewareOptions, input) {
    const auth = await value(options.auth, middlewareOptions, input)
    const session = await getSession(auth, middlewareOptions.context, dedupe)

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
  TInContext extends Context & RequestHeadersHandlerPluginContext & ResponseHeadersHandlerPluginContext,
  TInput,
  TAuth extends BetterAuthInstance,
>(
  { dedupe = true, ...options }: SessionMiddlewareOptions<TInContext, TInput, TAuth>,
): Middleware<TInContext, { session: InferBetterAuthSession<TAuth> | null }, TInput, any, Record<never, never>> {
  return async function optionalSession(middlewareOptions, input) {
    const auth = await value(options.auth, middlewareOptions, input)
    const session = await getSession(auth, middlewareOptions.context, dedupe)

    return middlewareOptions.next({ context: { session } })
  }
}

const SESSION_CACHE_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for('ORPC_BETTER_AUTH_SESSION_CACHE')

interface SessionCache {
  auth: BetterAuthInstance
  /**
   * Snapshot of `reqHeaders` at lookup time.
   */
  headers: string
  promise: Promise<unknown>
}

interface SessionCachedHeaders extends Headers {
  [SESSION_CACHE_SYMBOL]?: SessionCache | undefined
}

/**
 * Looks up the session and stores the lookup on `reqHeaders`, so other lookups of the same request can reuse it.
 * The `set-cookie` headers Better Auth returns (refreshed session, cookie cache) are appended to `resHeaders`.
 */
function getSession<TAuth extends BetterAuthInstance>(
  auth: TAuth,
  context: RequestHeadersHandlerPluginContext & ResponseHeadersHandlerPluginContext,
  dedupe: boolean,
): Promise<InferBetterAuthSession<TAuth> | null> {
  const reqHeaders: SessionCachedHeaders | undefined = context.reqHeaders

  /**
   * Without request headers there is no cookie or token to read, so the request is not authenticated.
   */
  if (!reqHeaders) {
    return Promise.resolve(null)
  }

  /**
   * Better Auth reads the session from headers such as `cookie`, `authorization`, or an API key header,
   * so a lookup is only reused while the headers are unchanged.
   */
  const headers = stringifyJSON([...reqHeaders])
  const cached = reqHeaders[SESSION_CACHE_SYMBOL]

  if (dedupe && cached?.auth === auth && cached.headers === headers) {
    return cached.promise as Promise<InferBetterAuthSession<TAuth> | null>
  }

  const promise = auth.api.getSession({ headers: reqHeaders, returnHeaders: true }).then((result) => {
    for (const cookie of result.headers.getSetCookie()) {
      context.resHeaders?.append('set-cookie', cookie)
    }

    return result.response
  })

  reqHeaders[SESSION_CACHE_SYMBOL] = { auth, headers, promise }

  return promise as Promise<InferBetterAuthSession<TAuth> | null>
}
