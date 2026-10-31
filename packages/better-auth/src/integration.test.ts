import type { RouterClient } from '@orpc/server'
import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'
import { call, ORPCError, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin, RequestHeadersHandlerPlugin, ResponseHeadersHandlerPlugin } from '@orpc/server/plugins'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { admin } from 'better-auth/plugins/admin'
import { optionalSession, requireSession } from './middleware'

const auth = betterAuth({
  baseURL: 'http://localhost',
  secret: 'better-auth-secret-for-orpc-integration-tests',
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: { enabled: true },
  /**
   * Refresh the session on every lookup and cache it in a cookie,
   * so lookups without the cache cookie return `set-cookie` headers.
   */
  session: { updateAge: 0, cookieCache: { enabled: true } },
  plugins: [admin()],
  logger: { disabled: true },
})

const base = os.$context<RequestHeadersHandlerPluginContext & ResponseHeadersHandlerPluginContext>()

/**
 * The "Permissions" example of the Better Auth integration docs.
 */
function requirePermission(permissions: Record<string, string[]>) {
  return os
    .middleware(requireSession({ auth }))
    .use(async ({ context, next }) => {
      const { success } = await auth.api.userHasPermission({
        body: { userId: context.session.user.id, permissions },
      })

      if (!success) {
        throw new ORPCError('FORBIDDEN')
      }

      return next()
    })
}

const router = {
  me: base.use(requireSession({ auth })).handler(({ context }) => context.session.user.email),
  greeting: base.use(optionalSession({ auth })).handler(({ context }) => `Hello, ${context.session?.user.name ?? 'guest'}`),
  ping: base.handler(() => 'pong'),
  listUsers: base.use(requirePermission({ user: ['list'] })).handler(() => 'users'),
}

const handler = new RPCHandler(router, {
  plugins: [
    new BatchHandlerPlugin(),
    new RequestHeadersHandlerPlugin(),
    new ResponseHeadersHandlerPlugin(),
  ],
})

async function signUp(email: string) {
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'password-1234', name: 'Ada' },
    returnHeaders: true,
  })

  // Keep only the session token, so the next lookup reads the database and sets the cookie cache.
  const cookie = headers.getSetCookie()
    .filter(cookie => cookie.startsWith('better-auth.session_token='))
    .map(cookie => cookie.split(';')[0])
    .join('; ')

  return { cookie, userId: response.user.id }
}

function createClient(cookie: string | undefined) {
  const responses: Response[] = []

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://localhost',
    headers: cookie ? { cookie } : {},
    plugins: [
      new BatchLinkPlugin({ groups: [{ condition: () => true, context: {} }] }),
    ],
    async fetch(url, init) {
      const { response } = await handler.handle(new Request(url, init), { prefix: '/rpc', context: {} })
      const resolved = response ?? new Response('Not Found', { status: 404 })
      responses.push(resolved)
      return resolved
    },
  })

  return { client: createORPCClient<RouterClient<typeof router>>(link), responses }
}

describe('better auth integration', () => {
  it('resolves the session and forwards refreshed cookies on the batch response', async () => {
    const { cookie } = await signUp('batch@example.com')
    const { client, responses } = createClient(cookie)

    expect(await Promise.all([client.me(), client.greeting(), client.ping()])).toEqual([
      'batch@example.com',
      'Hello, Ada',
      'pong',
    ])

    expect(responses).toHaveLength(1)
    expect(responses[0]!.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^better-auth\.session_token=/),
      expect.stringMatching(/^better-auth\.session_data=/),
    ]))
  })

  it('rejects unauthenticated calls and still serves public ones', async () => {
    const { client } = createClient(undefined)

    const [me, greeting] = await Promise.allSettled([client.me(), client.greeting()])

    expect(me).toEqual({ status: 'rejected', reason: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
    expect(greeting).toEqual({ status: 'fulfilled', value: 'Hello, guest' })
  })

  it('works in server-side calls with reqHeaders in the context', async () => {
    const { cookie } = await signUp('server@example.com')
    const resHeaders = new Headers()

    expect(await call(router.me, undefined, { context: { reqHeaders: new Headers({ cookie }), resHeaders } }))
      .toBe('server@example.com')

    expect(resHeaders.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^better-auth\.session_data=/),
    ]))
  })

  it('checks permissions with requirePermission', async () => {
    const { cookie, userId } = await signUp('permission@example.com')
    const context = () => ({ reqHeaders: new Headers({ cookie }) })

    await expect(call(router.listUsers, undefined, { context: context() })).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const { internalAdapter } = await auth.$context
    await internalAdapter.updateUser(userId, { role: 'admin' })

    expect(await call(router.listUsers, undefined, { context: context() })).toBe('users')
  })

  it('rejects unauthenticated calls before checking permissions', async () => {
    const spy = vi.spyOn(auth.api, 'userHasPermission')

    await expect(call(router.listUsers, undefined, { context: { reqHeaders: new Headers() } }))
      .rejects
      .toMatchObject({ code: 'UNAUTHORIZED' })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
