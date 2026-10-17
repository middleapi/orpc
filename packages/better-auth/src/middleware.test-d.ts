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
