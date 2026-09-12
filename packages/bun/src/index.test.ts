import { expect, it } from 'bun:test'

it('exports BunRedisRateLimiter, BunRedisPublisher, experimental_BunRedisCacheStore', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    BunRedisRateLimiter: expect.any(Function),
    BunRedisPublisher: expect.any(Function),
    experimental_BunRedisCacheStore: expect.any(Function),
  })
})
