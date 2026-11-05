import { expect, it } from 'bun:test'

it('exports BunRedisRateLimiter, BunRedisPublisher, experimental_BunRedisLocker', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    BunRedisRateLimiter: expect.any(Function),
    BunRedisPublisher: expect.any(Function),
    experimental_BunRedisLocker: expect.any(Function),
  })
})
