import type { BatchLinkPluginMode } from '@orpc/client/plugins'
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin, CookiesManagementLinkPlugin } from '@orpc/client/plugins'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin } from '@orpc/server/plugins'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { BetterAuthHandlerPlugin } from './handler-plugin'
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
  logger: { disabled: true },
})

const router = {
  me: os.use(requireSession({ auth })).handler(({ context }) => context.session.user.email),
  greeting: os.use(optionalSession({ auth })).handler(({ context }) => `Hello, ${context.session?.user.name ?? 'guest'}`),
  ping: os.handler(() => 'pong'),
}

const handler = new RPCHandler(router, {
  plugins: [new BatchHandlerPlugin(), new BetterAuthHandlerPlugin()],
})

function toCookieHeader(setCookies: string[]) {
  return setCookies.map(cookie => cookie.split(';')[0]).join('; ')
}

async function signUp(email: string) {
  const { headers } = await auth.api.signUpEmail({
    body: { email, password: 'password-1234', name: 'Ada' },
    returnHeaders: true,
  })

  // Keep only the session token so the next lookup has to refresh the cookie cache.
  return toCookieHeader(headers.getSetCookie().filter(cookie => cookie.startsWith('better-auth.session_token=')))
}

function createClient(options: { getCookie: () => string | undefined, mode?: BatchLinkPluginMode }) {
  const exchanges: { request: Request, response: Response }[] = []
  const setCookie = vi.fn()

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://localhost',
    plugins: [
      new BatchLinkPlugin({ groups: [{ condition: () => true, context: {} }], mode: options.mode ?? 'buffered' }),
      new CookiesManagementLinkPlugin({ getCookie: options.getCookie, setCookie }),
    ],
    async fetch(url, init) {
      const request = new Request(url, init)
      const { response } = await handler.handle(request, { prefix: '/rpc', context: {} })
      const resolved = response ?? new Response('Not Found', { status: 404 })
      exchanges.push({ request, response: resolved })
      return resolved
    },
  })

  return { client: createORPCClient<RouterClient<typeof router>>(link), exchanges, setCookie }
}

describe('better auth integration', () => {
  it('resolves the session once per batch and forwards refreshed cookies to the client', async () => {
    const cookie = await signUp('batch@example.com')
    const getSessionSpy = vi.spyOn(auth.api, 'getSession')
    const { client, exchanges, setCookie } = createClient({ getCookie: () => cookie })

    expect(await Promise.all([client.me(), client.greeting(), client.ping()])).toEqual([
      'batch@example.com',
      'Hello, Ada',
      'pong',
    ])

    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.request.headers.get('orpc-batch')).toBe('buffered')
    expect(exchanges[0]!.request.headers.get('cookie')).toBe(cookie)
    expect(getSessionSpy).toHaveBeenCalledTimes(1)

    expect(setCookie).toHaveBeenCalledTimes(1)
    expect(setCookie.mock.calls[0]![0]).toEqual([
      expect.stringMatching(/^better-auth\.session_token=/),
      expect.stringMatching(/^better-auth\.session_data=/),
    ])

    getSessionSpy.mockRestore()
  })

  it('rejects unauthenticated calls and still serves public ones', async () => {
    const { client, setCookie } = createClient({ getCookie: () => undefined })

    const [me, greeting] = await Promise.allSettled([client.me(), client.greeting()])

    expect(me).toEqual({ status: 'rejected', reason: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
    expect(greeting).toEqual({ status: 'fulfilled', value: 'Hello, guest' })
    expect(setCookie).not.toHaveBeenCalled()
  })

  it('resolves the session in streaming batch mode', async () => {
    const cookie = await signUp('streaming@example.com')
    const { client } = createClient({ getCookie: () => cookie, mode: 'streaming' })

    expect(await Promise.all([client.me(), client.greeting()])).toEqual(['streaming@example.com', 'Hello, Ada'])
  })
})
