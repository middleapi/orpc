import { isSuccessResponseStatus } from './codec'

describe('isSuccessResponseStatus', () => {
  it.each([100, 101, 199, 200, 201, 204, 299, 300, 301, 302, 304, 399])('treats status %i as success', (status) => {
    expect(isSuccessResponseStatus(status)).toBe(true)
  })

  it.each([400, 401, 403, 404, 499, 500, 502, 599, 600])('treats status %i as non-success', (status) => {
    expect(isSuccessResponseStatus(status)).toBe(false)
  })

  it('treats status 0 (opaque response, e.g. a redirect hidden by fetch) as non-success', () => {
    expect(isSuccessResponseStatus(0)).toBe(false)
  })
})
