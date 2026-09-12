import { expect, it } from 'vitest'

it('exports CloudflareRateLimiter, experimental_CloudflareTracer, experimental_WorkersCacheStore, DurablePublisher, DurablePublisherObject', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    CloudflareRateLimiter: expect.any(Function),
    experimental_CloudflareTracer: expect.any(Function),
    experimental_WorkersCacheStore: expect.any(Function),
    DurablePublisher: expect.any(Function),
    DurablePublisherObject: expect.any(Function),
  })
})
