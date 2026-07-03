import { expect, it } from 'vitest'

it('exports CloudflareRateLimiter, DurablePublisher, DurablePublisherObject', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    CloudflareRateLimiter: expect.any(Function),
    DurablePublisher: expect.any(Function),
    DurablePublisherObject: expect.any(Function),
  })
})
