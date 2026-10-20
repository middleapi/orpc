import { sleep } from '@orpc/shared'
import { Redis } from '@upstash/redis'
import { UpstashRateLimiter } from './upstash'

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * These tests depend on a real Upstash redis server — make sure to set the
 * `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` envs.
 * When writing new tests, always use unique keys to avoid conflicts with other
 * test cases.
 */
describe.concurrent('upstash rate limiter integration', {
  skip: !UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN,
  timeout: 20_000,
}, () => {
  const redis = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  })

  function createTestingRateLimiter(
    options: ConstructorParameters<typeof UpstashRateLimiter>[1] = {
      maxRequests: 3,
      window: 10_000,
    },
  ) {
    return new UpstashRateLimiter(redis, {
      prefix: `orpc-upstash-rate-limiter-${crypto.randomUUID()}:`,
      ...options,
    })
  }

  it('accepts weighted requests', async () => {
    const limiter = createTestingRateLimiter()

    await expect(limiter.limit('weighted', { weight: 2 })).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 1,
    })
  })

  it('tracks counters independently for each key', async () => {
    const limiter = createTestingRateLimiter()

    await expect(limiter.limit('alice')).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 2,
    })

    await expect(limiter.limit('bob')).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 2,
    })
  })

  it('returns a stable reset timestamp within the same window', async () => {
    const window = 2000
    const limiter = createTestingRateLimiter({
      maxRequests: 2,
      window,
    })
    const key = 'reset'
    const tolerance = 500

    const firstStartedAt = Date.now()
    const first = await limiter.limit(key)
    const firstCompletedAt = Date.now()

    expect(first).toMatchObject({
      success: true,
      limit: 2,
      remaining: 1,
    })
    expect(first.reset).toBeGreaterThanOrEqual(firstStartedAt + window - tolerance)
    expect(first.reset).toBeLessThanOrEqual(firstCompletedAt + window)

    await sleep(100)

    const second = await limiter.limit(key)

    expect(second).toMatchObject({
      success: true,
      limit: 2,
      remaining: 0,
    })
    expect(Math.abs(second.reset - first.reset)).toBeLessThanOrEqual(tolerance)

    const denied = await limiter.limit(key)

    expect(denied).toMatchObject({
      success: false,
      limit: 2,
      remaining: 0,
    })
    expect(Math.abs(denied.reset - first.reset)).toBeLessThanOrEqual(tolerance)
  })

  it('propagates client errors', async () => {
    const invalidRedis = new Redis({
      url: 'http://invalid:6379',
      token: 'invalid',
      retry: false,
    })
    const limiter = new UpstashRateLimiter(invalidRedis, {
      maxRequests: 3,
      window: 10_000,
    })

    await expect(limiter.limit('invalid-client')).rejects.toThrow()
  })

  it('rejects invalid weights', async () => {
    const limiter = createTestingRateLimiter()
    const key = 'invalid-weight'

    await expect(limiter.limit(key, { weight: 0 })).rejects.toThrow(TypeError)
    await expect(limiter.limit(key, { weight: -1 })).rejects.toThrow(TypeError)
    await expect(limiter.limit(key, { weight: 1.5 })).rejects.toThrow(
      'Rate limit weight must be an integer greater than 0',
    )
  })

  it('rejects requests that exceed the limit', async () => {
    const limiter = createTestingRateLimiter()
    const key = 'exceeded'

    await limiter.limit(key)
    await limiter.limit(key)
    await limiter.limit(key)

    await expect(limiter.limit(key)).resolves.toMatchObject({
      success: false,
      limit: 3,
      remaining: 0,
    })
  })

  describe('timeout', () => {
    it('waits until the next window when capacity is unavailable', async () => {
      const limiter = createTestingRateLimiter({
        maxRequests: 2,
        window: 1000,
        timeout: 4000,
      })
      const key = 'blocking'

      await limiter.limit(key)
      await limiter.limit(key)

      const start = Date.now()
      const result = await limiter.limit(key)

      expect(result).toMatchObject({
        success: true,
        limit: 2,
      })
      expect(Date.now() - start).toBeGreaterThanOrEqual(500)
    })

    it('waits until enough quota is available for weighted requests', async () => {
      const limiter = createTestingRateLimiter({
        maxRequests: 2,
        window: 1000,
        timeout: 4000,
      })
      const key = 'blocking-weighted'

      await expect(limiter.limit(key)).resolves.toMatchObject({
        success: true,
        remaining: 1,
      })

      await sleep(100)

      await expect(limiter.limit(key, { weight: 2 })).resolves.toMatchObject({
        success: true,
        limit: 2,
        remaining: 0,
      })
    })

    it('returns denial when reset exceeds timeout', async () => {
      const limiter = createTestingRateLimiter({
        maxRequests: 2,
        window: 10_000,
        timeout: 100,
      })
      const key = 'blocking-timeout'

      await limiter.limit(key)

      await sleep(100)

      await expect(limiter.limit(key, { weight: 2 })).resolves.toMatchObject({
        success: false,
        limit: 2,
        remaining: 0,
      })
    })
  })
})
