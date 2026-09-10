import { expect, it } from 'bun:test'

it('exports BunRedisRateLimiter, BunRedisPublisher, BunRedisCacheStore', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    BunRedisRateLimiter: expect.any(Function),
    BunRedisPublisher: expect.any(Function),
    BunRedisCacheStore: expect.any(Function),
  })
})
