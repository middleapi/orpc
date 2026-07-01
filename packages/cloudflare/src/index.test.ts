import { expect, it } from 'vitest'

it('exports CloudflareRateLimiter', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    CloudflareRateLimiter: expect.any(Function),
  })
})
