import { getRequestHeaders, getResponseHeaders, REQUEST_HEADERS_CONTEXT_SYMBOL, RESPONSE_HEADERS_CONTEXT_SYMBOL } from './headers'

it('getRequestHeaders & getResponseHeaders', () => {
  const requestHeaders = new Headers()
  const responseHeaders = new Headers()
  const context = { [REQUEST_HEADERS_CONTEXT_SYMBOL]: requestHeaders, [RESPONSE_HEADERS_CONTEXT_SYMBOL]: responseHeaders }

  expect(getRequestHeaders(context)).toBe(requestHeaders)
  expect(getResponseHeaders(context)).toBe(responseHeaders)

  expect(getRequestHeaders({})).toBeUndefined()
  expect(getResponseHeaders({ user: 'unnoticed' })).toBeUndefined()
})
