import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { UpstashRatelimiter } from './upstash-ratelimit'

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * These tests depend on a real Upstash redis server — make sure to set the `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` envs.
 * When writing new tests, always use unique keys to avoid conflicts with other test cases.
 */
describe.concurrent(
  'upstash ratelimit adapter',
  { skip: !UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN, timeout: 20_000 },
  () => {
    function createTestingRatelimiter(options: ConstructorParameters<typeof UpstashRatelimiter>[1] = {}) {
      const redis = new Redis({
        url: UPSTASH_REDIS_REST_URL,
        token: UPSTASH_REDIS_REST_TOKEN,
      })

      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(3, '10 s'),
        prefix: `rate-limit${crypto.randomUUID()}`,
      })

      return new UpstashRatelimiter(ratelimit, options)
    }

    it('should limit key successfully and return valid result', async () => {
      const ratelimiter = createTestingRatelimiter()
      const key = `test-key-${crypto.randomUUID()}`

      const result1 = await ratelimiter.limit(key)

      expect(result1).toMatchObject({
        success: true,
        limit: 3,
        remaining: 2,
      })
    })

    // retry: 5 to deal with upstash's rare condition limitation
    it('should block when blockingUntilReady is enabled', { retry: 5 }, async () => {
      const timeoutMs = 2000
      const ratelimiter = createTestingRatelimiter({
        blockingUntilReady: {
          enabled: true,
          timeout: timeoutMs,
        },
      })
      const key = `test-blocking-${crypto.randomUUID()}`

      // Fill up the rate limit first
      while (true) {
        const result = await ratelimiter.limit(key)
        if (!result.success) {
          break
        }
      }

      const startTime = Date.now()
      await expect(ratelimiter.limit(key)).resolves.toMatchObject({ success: false })
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(timeoutMs) // should wait until reach timeout
    })

    it('should use waitUntil callback when provided', async () => {
      const waitUntil = vi.fn()
      const ratelimiter = createTestingRatelimiter({
        waitUntil,
      })
      const key = `test-waituntil-${crypto.randomUUID()}`

      const result1 = await ratelimiter.limit(key)
      expect(waitUntil).toHaveBeenCalledTimes(1)
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
    })
  },
)
