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

const SESSION_CONTEXT_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for('ORPC_BETTER_AUTH_SESSION_CONTEXT')

interface SessionContext extends RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext {
  /**
   * The session an earlier session middleware of this call looked up, for deduplication.
   */
  [SESSION_CONTEXT_SYMBOL]?: { auth: BetterAuthInstance, session: unknown } | undefined
}

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
   * If the session middlewares are used multiple times
   * or you invoke a procedure inside another procedure (shared the same context) that also has
   * session middlewares **with the same auth instance**, this option
   * will ensure that the session is only looked up once per call.
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
): Middleware<TInContext, { session: TAuth['$Infer']['Session'] }, TInput, any, Record<never, never>> {
  return async function requireSession(middlewareOptions, input) {
    const auth = await value(options.auth, middlewareOptions, input)
    const session = await getSession(auth, middlewareOptions.context, dedupe)

    if (!session) {
      throw new ORPCError('UNAUTHORIZED')
    }

    const context = { session, [SESSION_CONTEXT_SYMBOL]: { auth, session } }
    return middlewareOptions.next({ context })
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
): Middleware<TInContext, { session: TAuth['$Infer']['Session'] | null }, TInput, any, Record<never, never>> {
  return async function optionalSession(middlewareOptions, input) {
    const auth = await value(options.auth, middlewareOptions, input)
    const session = await getSession(auth, middlewareOptions.context, dedupe)

    const context = { session, [SESSION_CONTEXT_SYMBOL]: { auth, session } }
    return middlewareOptions.next({ context })
  }
}

/**
 * Looks up the session, or reuses the one an earlier session middleware of this call looked up.
 * The `set-cookie` headers Better Auth returns (refreshed session, cookie cache) are appended to `resHeaders`.
 */
async function getSession<TAuth extends BetterAuthInstance>(
  auth: TAuth,
  context: SessionContext,
  dedupe: boolean,
): Promise<TAuth['$Infer']['Session'] | null> {
  const previous = context[SESSION_CONTEXT_SYMBOL]

  if (dedupe && previous?.auth === auth) {
    return previous.session
  }

  /**
   * Without request headers there is no cookie or token to read, so the request is not authenticated.
   */
  if (!context.reqHeaders) {
    return null
  }

  const { headers, response } = await auth.api.getSession({ headers: context.reqHeaders, returnHeaders: true })

  for (const cookie of headers.getSetCookie()) {
    context.resHeaders?.append('set-cookie', cookie)
  }

  return response
}
