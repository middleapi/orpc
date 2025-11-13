import { CloudflareRatelimiter } from './cloudflare-ratelimit'

it('cloudflareRatelimiter', async () => {
  const ratelimit = {
    limit: vi.fn(() => Promise.resolve({ success: true })),
  }

  const ratelimiter = new CloudflareRatelimiter(ratelimit)

  const result = ratelimiter.limit('test-key')

  expect(ratelimit.limit).toHaveBeenCalledTimes(1)
  expect(ratelimit.limit).toHaveBeenCalledWith({ key: 'test-key' })
  expect(result).toBe(ratelimit.limit.mock.results[0]!.value)

  expect(await result).toEqual({ success: true })
})
