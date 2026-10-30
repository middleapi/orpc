import { BETTER_AUTH_CONTEXT_SYMBOL, createBetterAuthContext, createBetterAuthRequestState, getBetterAuthRequestState } from './context'

describe('createBetterAuthContext', () => {
  it('accepts fetch headers', () => {
    const headers = new Headers({ cookie: 'session=abc' })
    const state = createBetterAuthContext({ headers })[BETTER_AUTH_CONTEXT_SYMBOL]

    expect(state.headers).toBe(headers)
    expect(state.setCookies).toEqual([])
  })

  it('accepts standard headers', () => {
    const state = createBetterAuthContext({
      headers: { 'cookie': 'session=abc', 'x-multi': ['a', 'b'], 'x-empty': undefined },
    })[BETTER_AUTH_CONTEXT_SYMBOL]

    expect(state.headers).toBeInstanceOf(Headers)
    expect(state.headers.get('cookie')).toBe('session=abc')
    expect(state.headers.get('x-multi')).toBe('a, b')
    expect(state.headers.has('x-empty')).toBe(false)
  })
})

it('createBetterAuthRequestState resolves headers lazily and once', () => {
  const headers = new Headers()
  const getHeaders = vi.fn(() => headers)
  const state = createBetterAuthRequestState(getHeaders)

  expect(getHeaders).not.toHaveBeenCalled()
  expect(state.headers).toBe(headers)
  expect(state.headers).toBe(headers)
  expect(getHeaders).toHaveBeenCalledTimes(1)
})

describe('getBetterAuthRequestState', () => {
  it('returns the state from context', () => {
    const context = createBetterAuthContext({ headers: new Headers() })

    expect(getBetterAuthRequestState(context)).toBe(context[BETTER_AUTH_CONTEXT_SYMBOL])
  })

  it('throws a descriptive error when the state is missing', () => {
    expect(() => getBetterAuthRequestState({})).toThrow(/BetterAuthHandlerPlugin.*createBetterAuthContext/)
  })
})
