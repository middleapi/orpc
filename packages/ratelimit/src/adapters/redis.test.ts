import type { RedisRatelimiterOptions } from './redis'
import { Redis } from 'ioredis'
import { RedisRatelimiter } from './redis'

const REDIS_URL = process.env.REDIS_URL

/**
 * These tests depend on a real Redis server — make sure to set the `REDIS_URL` env.
 * When writing new tests, always use unique keys to avoid conflicts with other test cases.
 */
describe.concurrent('ioredis ratelimiter', { skip: !REDIS_URL, timeout: 20000 }, () => {
  let redis: Redis

  function createTestingRatelimiter(options: Partial<RedisRatelimiterOptions> = {}) {
    const ratelimiter = new RedisRatelimiter({
      eval: redis.eval.bind(redis),
      prefix: `test:${crypto.randomUUID()}:`, // isolated from other tests
      maxRequests: 10,
      window: 60000,
      ...options,
    })
    return ratelimiter
  }

  beforeAll(() => {
    redis = new Redis(REDIS_URL!)
  })

  afterAll(async () => {
    await redis.quit()
    expect(redis.listenerCount('error')).toEqual(0)
  })

  describe('without blocking', () => {
    it('allows requests within the limit', async () => {
      const ratelimiter = createTestingRatelimiter({ maxRequests: 2, window: 5000 })
      const key = 'user1'

      const result1 = await ratelimiter.limit(key)
      expect(result1.success).toBe(true)
      expect(result1.limit).toBe(2)
      expect(result1.remaining).toBe(1)
      expect(result1.reset).toBeGreaterThan(Date.now())

      const result2 = await ratelimiter.limit(key)
      expect(result2.success).toBe(true)
      expect(result2.limit).toBe(2)
      expect(result2.remaining).toBe(0)
      expect(result2.reset).toEqual(result1.reset)
    })

    it('denies requests exceeding the limit', async () => {
      const ratelimiter = createTestingRatelimiter({ maxRequests: 1, window: 5000 })
      const key = 'user2'

      // reach the limit
      const result1 = await ratelimiter.limit(key)
      expect(result1.remaining).toBe(0)

      const result2 = await ratelimiter.limit(key)
      expect(result2.success).toBe(false)
    })

    it('resets the limit after the window expires', async () => {
      const ratelimiter = createTestingRatelimiter({ maxRequests: 1, window: 2000 })
      const key = 'user3'

      // reach the limit
      const result1 = await ratelimiter.limit(key)
      expect(result1.remaining).toBe(0)
      const result2 = await ratelimiter.limit(key)
      expect(result2.success).toBe(false)

      // wait for the window to expire
      await new Promise(resolve => setTimeout(resolve, 2000))

      const result3 = await ratelimiter.limit(key)
      expect(result3.success).toBe(true)
    })
  })

  it('handles concurrent requests correctly', async () => {
    const ratelimiter = createTestingRatelimiter({
      maxRequests: 3,
      window: 5000,
    })

    const test = async (key: string) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => ratelimiter.limit(key)),
      )

      // Count successful and failed requests
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length

      // Should have exactly maxRequests successful requests
      expect(successful).toBe(3)
      expect(failed).toBe(2)

      // Verify remaining counts are consistent
      const successfulResults = results.filter(r => r.success)
      expect(successfulResults[0]!.remaining).toBe(2)
      expect(successfulResults[1]!.remaining).toBe(1)
      expect(successfulResults[2]!.remaining).toBe(0)
    }

    await Promise.all(
      Array.from({ length: 5 }, (_, i) => test(`test${i}`)),
    )
  })

  describe('with blocking', () => {
    it('blocks until the rate limit resets', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 1,
        window: 2000,
        blockingUntilReady: { enabled: true, timeout: 2000 },
      })
      const key = 'user-blocking-1'

      // reach the limit
      const result1 = await ratelimiter.limit(key)
      expect(result1.remaining).toBe(0)

      const startTime = Date.now()
      const result2 = await ratelimiter.limit(key)
      const endTime = Date.now()

      expect(result2.success).toBe(true)
      expect(endTime - startTime).toBeGreaterThanOrEqual(500) // actually waited
      expect(endTime - startTime).toBeLessThanOrEqual(2000)
    })

    it('times out if the reset time is beyond the timeout', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 1,
        window: 60_000,
        blockingUntilReady: { enabled: true, timeout: 2000 },
      })
      const key = 'user-blocking-2'

      await ratelimiter.limit(key) // Consume the first request

      const startTime = Date.now()
      const result = await ratelimiter.limit(key)
      const endTime = Date.now()

      expect(result.success).toBe(false) // Should fail as it times out
      expect(endTime - startTime).toBeLessThan(2000)
    })

    it('handles concurrent blocking requests correctly', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 2,
        window: 1000,
        blockingUntilReady: { enabled: true, timeout: 2000 },
      })
      const key = 'user-concurrent-blocking'

      const promises = [
        ratelimiter.limit(key),
        ratelimiter.limit(key),
        ratelimiter.limit(key), // This one should block
      ]

      const results = await Promise.all(promises)
      expect(results.filter(r => r.success).length).toBe(3)
    })
  })

  describe('edge cases', () => {
    it('uses the correct prefix for keys & auto expiration', async () => {
      const prefix = `custom-prefix:${crypto.randomUUID()}:`
      const ratelimiter = createTestingRatelimiter({
        window: 1000,
        prefix,
        maxRequests: 1,
      })
      const key = 'user4'

      await ratelimiter.limit(key)

      const keys = await redis.keys(`${prefix}${key}`)
      expect(keys).toHaveLength(1)

      // Wait until the key is auto-expired
      await vi.waitFor(async () => {
        const keysAfterExpiry = await redis.keys(`${prefix}${key}`)
        expect(keysAfterExpiry).toHaveLength(0)
      }, { timeout: 20_000, interval: 1000 })
    })

    it('handles Redis errors gracefully', async () => {
      const ratelimiter = new RedisRatelimiter({
        eval: async () => { throw new Error('Redis error') },
        maxRequests: 10,
        window: 60000,
      })
      await expect(ratelimiter.limit('some-key')).rejects.toThrow('Redis error')
    })

    it('handles invalid script response', async () => {
      const ratelimiter = new RedisRatelimiter({
        eval: async () => [1, 2, 3], // Invalid response, should have 4 elements
        maxRequests: 10,
        window: 60000,
      })
      await expect(ratelimiter.limit('some-key')).rejects.toThrow('Invalid response from rate limit script')
    })

    it('handles invalid script response 2', async () => {
      const ratelimiter = new RedisRatelimiter({
        eval: async () => ['a', 'b', 'c', 'd'], // should be integers
        maxRequests: 10,
        window: 60000,
      })
      await expect(ratelimiter.limit('some-key')).rejects.toThrow('Invalid response from rate limit script')
    })
  })
})
