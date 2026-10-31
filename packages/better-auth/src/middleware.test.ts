import { call, ORPCError, os, type } from '@orpc/server'
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

describe('requireSession', () => {
  it('adds the session to context', async () => {
    const auth = createAuth()
    const reqHeaders = new Headers({ cookie: 'session=abc' })
    const procedure = os.use(requireSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: { reqHeaders } })).toEqual(session)
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    expect(auth.api.getSession).toHaveBeenCalledWith({ headers: reqHeaders, returnHeaders: true })
  })

  it('throws UNAUTHORIZED when there is no session', async () => {
    const auth = createAuth()
    const handler = vi.fn()
    const procedure = os.use(requireSession({ auth })).handler(handler)

    const promise = call(procedure, undefined, { context: { reqHeaders: new Headers() } })

    await expect(promise).rejects.toBeInstanceOf(ORPCError)
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('throws UNAUTHORIZED without reqHeaders', async () => {
    const auth = createAuth()
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await expect(call(procedure, undefined, { context: {} })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })
})

describe('optionalSession', () => {
  it('adds the session to context', async () => {
    const auth = createAuth()
    const procedure = os.use(optionalSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }) } })).toEqual(session)
  })

  it('adds null to context when there is no session', async () => {
    const auth = createAuth()
    const procedure = os.use(optionalSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: { reqHeaders: new Headers() } })).toBeNull()
  })

  it('adds null to context without reqHeaders', async () => {
    const auth = createAuth()
    const procedure = os.use(optionalSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: {} })).toBeNull()
    expect(auth.api.getSession).not.toHaveBeenCalled()
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

    const context = { reqHeaders: new Headers({ cookie: 'session=abc' }), tenant: 'a' }

    expect(await call(procedure, '__input__', { context, path: ['__path__'] })).toEqual(session)
    expect(authFn).toHaveBeenCalledTimes(1)
    expect(authFn).toHaveBeenCalledWith(
      expect.objectContaining({ procedure, path: ['__path__'], context: expect.objectContaining({ tenant: 'a' }) }),
      '__input__',
    )
  })

  it('works without resHeaders when Better Auth returns set-cookie headers', async () => {
    const auth = createAuth(['session=refreshed'])
    const procedure = os.use(requireSession({ auth })).handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }) } })).toEqual(session)
  })

  it('lets errors from getSession propagate', async () => {
    const auth = createAuth()
    const error = new Error('database is down')
    auth.api.getSession.mockRejectedValueOnce(error)
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await expect(call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }) } })).rejects.toBe(error)
  })

  it('appends set-cookie headers to resHeaders', async () => {
    const auth = createAuth(['session=refreshed', 'session_data=cached'])
    const resHeaders = new Headers()
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }), resHeaders } })

    expect(resHeaders.getSetCookie()).toEqual(['session=refreshed', 'session_data=cached'])
  })

  it('looks up the session once for chained middlewares', async () => {
    const auth = createAuth(['session=refreshed'])
    const resHeaders = new Headers()
    const procedure = os
      .use(optionalSession({ auth }))
      .use(requireSession({ auth }))
      .handler(({ context }) => context.session)

    expect(await call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }), resHeaders } })).toEqual(session)
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    expect(resHeaders.getSetCookie()).toEqual(['session=refreshed'])
  })

  it('reuses a missing session, so requireSession after optionalSession throws without a new lookup', async () => {
    const auth = createAuth()
    const procedure = os
      .use(optionalSession({ auth }))
      .use(requireSession({ auth }))
      .handler(() => 'ok')

    await expect(call(procedure, undefined, { context: { reqHeaders: new Headers() } })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
  })

  it('looks up the session once for a procedure called inside another with the same context', async () => {
    const auth = createAuth()
    const inner = os.use(requireSession({ auth })).handler(({ context }) => context.session)
    const outer = os.use(requireSession({ auth })).handler(({ context }) => call(inner, undefined, { context }))

    expect(await call(outer, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }) } })).toEqual(session)
    expect(auth.api.getSession).toHaveBeenCalledTimes(1)
  })

  it('looks up again for a different auth instance', async () => {
    const authA = createAuth(['a=1'])
    const authB = createAuth(['b=1'])
    const resHeaders = new Headers()
    const procedure = os
      .use(requireSession({ auth: authA }))
      .use(requireSession({ auth: () => authB }))
      .handler(() => 'ok')

    await call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }), resHeaders } })

    expect(authA.api.getSession).toHaveBeenCalledTimes(1)
    expect(authB.api.getSession).toHaveBeenCalledTimes(1)
    expect(resHeaders.getSetCookie()).toEqual(['a=1', 'b=1'])
  })

  it('looks up again with dedupe: false', async () => {
    const auth = createAuth()
    const procedure = os
      .use(optionalSession({ auth }))
      .use(requireSession({ auth, dedupe: false }))
      .use(requireSession({ auth }))
      .handler(() => 'ok')

    await call(procedure, undefined, { context: { reqHeaders: new Headers({ cookie: 'session=abc' }) } })

    expect(auth.api.getSession).toHaveBeenCalledTimes(2)
  })

  it('looks up again for each call, even with the same reqHeaders', async () => {
    const auth = createAuth()
    const reqHeaders = new Headers({ cookie: 'session=abc' })
    const procedure = os.use(requireSession({ auth })).handler(() => 'ok')

    await call(procedure, undefined, { context: { reqHeaders } })
    await call(procedure, undefined, { context: { reqHeaders } })

    expect(auth.api.getSession).toHaveBeenCalledTimes(2)
  })
})
