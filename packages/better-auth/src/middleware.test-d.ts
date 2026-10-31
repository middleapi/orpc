import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import { os, type } from '@orpc/server'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { optionalSession, requireSession } from './middleware'

const auth = betterAuth({
  database: memoryAdapter({}),
  user: {
    additionalFields: {
      role: { type: 'string', required: true },
    },
  },
})

type Session = typeof auth.$Infer.Session

describe('requireSession', () => {
  it('infers a non-null session from the auth instance', () => {
    os.use(requireSession({ auth })).handler(({ context }) => {
      expectTypeOf(context.session).toEqualTypeOf<Session>()
      expectTypeOf(context.session.user.role).toBeString()
    })
  })

  it('infers the session from an auth factory and receives context and input', () => {
    os
      .$context<{ auth: typeof auth, tenant: string }>()
      .input(type<{ id: number }>())
      .use(requireSession({
        auth: async ({ context }, input) => {
          expectTypeOf(context.tenant).toBeString()
          expectTypeOf(input.id).toBeNumber()

          return context.auth
        },
      }))
      .handler(({ context }) => {
        expectTypeOf(context.session).toEqualTypeOf<Session>()
        expectTypeOf(context.tenant).toBeString()
      })
  })

  it('works with the request and response headers plugin contexts', () => {
    os
      .$context<RequestHeadersHandlerPluginContext & ResponseHeadersHandlerPluginContext & { auth: typeof auth }>()
      .use(requireSession({ auth: ({ context }) => context.auth }))
      .handler(({ context }) => {
        expectTypeOf(context.session).toEqualTypeOf<Session>()
        expectTypeOf(context.reqHeaders).toEqualTypeOf<Headers | undefined>()
        expectTypeOf(context.resHeaders).toEqualTypeOf<Headers | undefined>()
      })
  })

  it('returns a decorated middleware whose .use sees the session', () => {
    const middleware = requireSession({ auth }).use(({ context, next }) => {
      expectTypeOf(context.session).toEqualTypeOf<Session>()

      return next({ context: { role: context.session.user.role } })
    })

    os.use(middleware).handler(({ context }) => {
      expectTypeOf(context.session).toEqualTypeOf<Session>()
      expectTypeOf(context.role).toBeString()
    })
  })

  it('rejects a context with incompatible reqHeaders or resHeaders', () => {
    // @ts-expect-error reqHeaders must be Headers
    os.$context<{ reqHeaders: string }>().use(requireSession({ auth }))
    // @ts-expect-error resHeaders must be Headers
    os.$context<{ resHeaders: Record<string, string> }>().use(optionalSession({ auth }))
  })

  it('rejects values that are not Better Auth instances', () => {
    // @ts-expect-error not an auth instance
    requireSession({ auth: {} })
    // @ts-expect-error not an auth instance
    requireSession({ auth: () => ({ api: {} }) })
  })
})

describe('optionalSession', () => {
  it('infers a nullable session from the auth instance', () => {
    os.use(optionalSession({ auth })).handler(({ context }) => {
      expectTypeOf(context.session).toEqualTypeOf<Session | null>()
    })
  })

  it('infers the session from an auth factory', () => {
    os
      .$context<{ auth: typeof auth }>()
      .use(optionalSession({ auth: ({ context }) => context.auth }))
      .handler(({ context }) => {
        expectTypeOf(context.session).toEqualTypeOf<Session | null>()
      })
  })
})
