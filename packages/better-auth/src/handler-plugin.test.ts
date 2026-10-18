import type { ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import type { BetterAuthContext } from './context'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin, ResponseHeadersHandlerPlugin } from '@orpc/server/plugins'
import { BETTER_AUTH_CONTEXT_SYMBOL, createBetterAuthContext } from './context'
import { BetterAuthHandlerPlugin } from './handler-plugin'
import { optionalSession, requireSession } from './middleware'

const session = { session: { id: 'session-id' }, user: { id: 'user-id', name: 'Ada' } }

function createAuth(setCookies: string[] = []) {
  return {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers, returnHeaders: true }) => {
        const responseHeaders = new Headers()
        for (const cookie of setCookies) {
          responseHeaders.append('set-cookie', cookie)
        }

        return { headers: responseHeaders, response: headers.get('cookie') ? session : null }
      }),
    },
    $Infer: {} as { Session: typeof session },
  }
}

function createRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/rpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
}

function createBatchRequest(paths: string[], headers: Record<string, string> = {}) {
  return new Request('http://localhost/rpc/__batch__', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'orpc-batch': 'buffered', ...headers },
    body: JSON.stringify(paths.map((path, id) => ({
      kind: 'request',
      id,
      json: { method: 'POST', url: `/rpc/${path}`, headers: { 'content-type': 'application/json' }, body: {} },
      binary: undefined,
    }))),
  })
}

describe('betterAuthHandlerPlugin', () => {
  const auth = createAuth(['session=refreshed; Path=/; HttpOnly', 'cache=1; Path=/'])

  const router = {
    public: os.handler(() => 'public'),
    me: os.use(requireSession({ auth })).handler(({ context }) => context.session.user.name),
    maybe: os.use(optionalSession({ auth })).handler(({ context }) => context.session?.user.name ?? null),
  }

  const handler = new RPCHandler(router, {
    plugins: [new BetterAuthHandlerPlugin(), new BatchHandlerPlugin()],
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the session from request headers and applies set-cookie to the response', async () => {
    const { response } = await handler.handle(createRequest('me', { cookie: 'session=abc' }), { prefix: '/rpc', context: {} })

    expect(await response!.json()).toEqual({ json: 'Ada' })
    expect(response!.headers.getSetCookie()).toEqual(['session=refreshed; Path=/; HttpOnly', 'cache=1; Path=/'])
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    expect(auth.api.getSession.mock.calls[0]![0].headers.get('cookie')).toBe('session=abc')
  })

  it('applies set-cookie to error responses', async () => {
    const { response } = await handler.handle(createRequest('me'), { prefix: '/rpc', context: {} })

    expect(response!.status).toBe(401)
    expect(response!.headers.getSetCookie()).toEqual(['session=refreshed; Path=/; HttpOnly', 'cache=1; Path=/'])
  })

  it('does not look up the session or set cookies when no procedure asks for it', async () => {
    const { response } = await handler.handle(createRequest('public', { cookie: 'session=abc' }), { prefix: '/rpc', context: {} })

    expect(await response!.json()).toEqual({ json: 'public' })
    expect(response!.headers.getSetCookie()).toEqual([])
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('passes through unmatched requests', async () => {
    const { matched } = await handler.handle(createRequest('not-found'), { prefix: '/rpc', context: {} })

    expect(matched).toBe(false)
  })

  it('reuses the state already in context', async () => {
    const context = createBetterAuthContext({ headers: new Headers({ cookie: 'session=from-context' }) })

    const { response } = await handler.handle(createRequest('me'), { prefix: '/rpc', context })

    expect(response!.status).toBe(200)
    expect(auth.api.getSession.mock.calls[0]![0].headers.get('cookie')).toBe('session=from-context')
    expect(response!.headers.getSetCookie()).toHaveLength(2)
    expect(context[BETTER_AUTH_CONTEXT_SYMBOL].setCookies).toEqual([])
  })

  it('appends to set-cookie headers set by procedures', async () => {
    const handler = new RPCHandler({
      login: os
        .$context<ResponseHeadersHandlerPluginContext & BetterAuthContext>()
        .use(requireSession({ auth }))
        .handler(({ context }) => {
          context.resHeaders?.append('set-cookie', 'procedure=1')
        }),
    }, {
      plugins: [new BetterAuthHandlerPlugin(), new ResponseHeadersHandlerPlugin()],
    })

    const { response } = await handler.handle(createRequest('login', { cookie: 'session=abc' }), { prefix: '/rpc', context: {} })

    expect(response!.headers.getSetCookie()).toEqual([
      'procedure=1',
      'session=refreshed; Path=/; HttpOnly',
      'cache=1; Path=/',
    ])
  })

  it('shares one lookup across batch subrequests and applies set-cookie to the batch response', async () => {
    const { response } = await handler.handle(
      createBatchRequest(['me', 'maybe', 'public'], { cookie: 'session=abc' }),
      { prefix: '/rpc', context: {} },
    )

    expect(response!.status).toBe(207)
    const messages = await response!.json()
    expect(messages).toHaveLength(3)
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 0, json: expect.objectContaining({ body: { json: 'Ada' } }) }),
      expect.objectContaining({ id: 1, json: expect.objectContaining({ body: { json: 'Ada' } }) }),
      expect.objectContaining({ id: 2, json: expect.objectContaining({ body: { json: 'public' } }) }),
    ]))
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    expect(response!.headers.getSetCookie()).toEqual(['session=refreshed; Path=/; HttpOnly', 'cache=1; Path=/'])
  })
})
