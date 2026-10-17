import { call, ORPCError, os, type } from '@orpc/server'
import { BETTER_AUTH_CONTEXT_SYMBOL, createBetterAuthContext } from './context'
import { optionalSession, requireSession } from './middleware'

const session = { session: { id: 'session-id' }, user: { id: 'user-id', name: 'Ada' } }

function createAuth(response: unknown = session, setCookies: string[] = []) {
  return {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers, returnHeaders: true }) => {
        const responseHeaders = new Headers()
        for (const cookie of setCookies) {
          responseHeaders.append('set-cookie', cookie)
        }

        return { headers: responseHeaders, response: headers.get('cookie') ? response : null }
      }),
    },
    $Infer: {} as { Session: typeof session },
  }
}

describe('requireSession', () => {
  it('adds the session to context', async () => {
    const auth = createAuth()
    const headers = new Headers({ cookie: 'session=abc' })
    const procedure = os.use(requireSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: createBetterAuthContext({ headers }) })).toEqual(session)
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    expect(auth.api.getSession).toHaveBeenCalledWith({ headers, returnHeaders: true })
  })

  it('throws UNAUTHORIZED when there is no session', async () => {
    const auth = createAuth()
    const handler = vi.fn()
    const procedure = os.use(requireSession({ auth })).handler(handler)

    const promise = call(procedure, undefined, { context: createBetterAuthContext({ headers: new Headers() }) })

    await expect(promise).rejects.toBeInstanceOf(ORPCError)
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('lets errors from getSession propagate', async () => {
    const auth = createAuth()
    const error = new Error('database is down')
    auth.api.getSession.mockRejectedValueOnce(error)
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await expect(
      call(procedure, undefined, { context: createBetterAuthContext({ headers: new Headers() }) }),
    ).rejects.toBe(error)
  })

  it('throws a descriptive error without the plugin or createBetterAuthContext', async () => {
    const auth = createAuth()
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await expect(call(procedure, undefined, { context: {} })).rejects.toThrow(/BetterAuthHandlerPlugin/)
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })
})

describe('optionalSession', () => {
  it('adds the session to context', async () => {
    const auth = createAuth()
    const procedure = os.use(optionalSession({ auth })).handler(({ context }) => context.session)

    expect(
      await call(procedure, undefined, { context: createBetterAuthContext({ headers: new Headers({ cookie: 'session=abc' }) }) }),
    ).toEqual(session)
  })

  it('adds null to context when there is no session', async () => {
    const auth = createAuth()
    const procedure = os.use(optionalSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: createBetterAuthContext({ headers: new Headers() }) })).toBeNull()
  })
})

describe('session lookup', () => {
  it('resolves auth from a function receiving middleware options and input', async () => {
    const auth = createAuth()
    const authFn = vi.fn(async () => auth)
    const procedure = os
      .input(type<string>())
      .use(optionalSession({ auth: authFn }))
      .handler(({ context }) => context.session)

    const context = { ...createBetterAuthContext({ headers: new Headers({ cookie: 'session=abc' }) }), tenant: 'a' }

    expect(await call(procedure, '__input__', { context, path: ['__path__'] })).toEqual(session)
    expect(authFn).toHaveBeenCalledTimes(1)
    expect(authFn).toHaveBeenCalledWith(
      expect.objectContaining({ procedure, path: ['__path__'], context: expect.objectContaining({ tenant: 'a' }) }),
      '__input__',
    )
  })

  it('is lazy, so procedures without a session middleware do not look up the session', async () => {
    const auth = createAuth()
    const context = createBetterAuthContext({ headers: new Headers() })

    await call(os.handler(() => 'ok'), undefined, { context })

    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('runs once per request and auth instance', async () => {
    const auth = createAuth(session, ['session=refreshed'])
    const context = createBetterAuthContext({ headers: new Headers({ cookie: 'session=abc' }) })
    const procedure = os
      .use(optionalSession({ auth }))
      .use(requireSession({ auth }))
      .handler(({ context }) => context.session)

    await Promise.all([
      call(procedure, undefined, { context }),
      call(procedure, undefined, { context }),
    ])

    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    expect(context[BETTER_AUTH_CONTEXT_SYMBOL].setCookies).toEqual(['session=refreshed'])
  })

  it('runs once per auth instance', async () => {
    const authA = createAuth(session, ['a=1'])
    const authB = createAuth(session, ['b=1'])
    const context = createBetterAuthContext({ headers: new Headers({ cookie: 'session=abc' }) })
    const procedure = os
      .use(requireSession({ auth: authA }))
      .use(requireSession({ auth: () => authB }))
      .handler(() => 'ok')

    await call(procedure, undefined, { context })

    expect(authA.api.getSession).toHaveBeenCalledTimes(1)
    expect(authB.api.getSession).toHaveBeenCalledTimes(1)
    expect(context[BETTER_AUTH_CONTEXT_SYMBOL].setCookies).toEqual(['a=1', 'b=1'])
  })

  it('runs again for a new request', async () => {
    const auth = createAuth()
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await call(procedure, undefined, { context: createBetterAuthContext({ headers: new Headers({ cookie: 'a' }) }) })
    await call(procedure, undefined, { context: createBetterAuthContext({ headers: new Headers({ cookie: 'b' }) }) })

    expect(auth.api.getSession).toHaveBeenCalledTimes(2)
  })
})
