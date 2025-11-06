import { sleep } from '@orpc/shared'
import { describe, expect, it } from 'vitest'
import { MemoryRatelimiter } from './memory'

describe('memoryRatelimiter', () => {
  function createTestingRatelimiter(options: Partial<ConstructorParameters<typeof MemoryRatelimiter>[0]> = {}) {
    return new MemoryRatelimiter({
      maxRequests: 2,
      window: 1000,
      ...options,
    })
  }

  describe('basic rate limiting', () => {
    it('should allow requests within limit', async () => {
      const ratelimiter = createTestingRatelimiter()

      const result1 = await ratelimiter.limit('test')
      expect(result1.success).toBe(true)
      expect(result1.remaining).toBe(1)
      expect(result1.limit).toBe(2)
      expect(result1.reset).toBeGreaterThan(Date.now())

      const result2 = await ratelimiter.limit('test')
      expect(result2.success).toBe(true)
      expect(result2.remaining).toBe(0)
      expect(result2.limit).toBe(2)
      expect(result2.reset).toEqual(result1.reset)

      const result3 = await ratelimiter.limit('test')
      expect(result3.success).toBe(false)
      expect(result3.remaining).toBe(0)
      expect(result3.limit).toBe(2)
      expect(result3.reset).toEqual(result1.reset)
    })

    it('should reset after window expires', async () => {
      const ratelimiter = createTestingRatelimiter({
        window: 200,
        maxRequests: 3.0,
      })

      const result1 = await ratelimiter.limit('test')
      expect(result1.remaining).toBe(2)
      const result2 = await ratelimiter.limit('test')
      expect(result2.remaining).toBe(1)
      const result3 = await ratelimiter.limit('test')
      expect(result3.remaining).toBe(0)

      await sleep(210)

      const result4 = await ratelimiter.limit('test')
      expect(result4.success).toBe(true)
      expect(result4.remaining).toBe(2)
    })

    it('should handle multiple keys independently', async () => {
      const ratelimiter = createTestingRatelimiter()

      const result1 = await ratelimiter.limit('test1')
      expect(result1.success).toBe(true)
      expect(result1.remaining).toBe(1)

      const result2 = await ratelimiter.limit('test2')
      expect(result2.success).toBe(true)
      expect(result2.remaining).toBe(1)
    })
  })

  describe('blocking mode', () => {
    it('should block until ready', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 1,
        window: 1000,
        blockingUntilReady: {
          enabled: true,
          timeout: 2000,
        },
      })

      const result1 = await ratelimiter.limit('test')
      expect(result1.remaining).toEqual(0)

      const start = Date.now()
      const result2 = await ratelimiter.limit('test')
      const end = Date.now()
      expect(result2.success).toEqual(true)
      expect(end - start).toBeGreaterThanOrEqual(100) // actually await
      expect(end - start).toBeLessThanOrEqual(1100)
    })

    it('should respect timeout', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 1,
        window: 2000,
        blockingUntilReady: {
          enabled: true,
          timeout: 1000,
        },
      })

      const result1 = await ratelimiter.limit('test')
      expect(result1.remaining).toBe(0)

      const result2 = await ratelimiter.limit('test')
      expect(result2.success).toBe(false)
    })
  })

  it('should handle concurrent requests correctly', async () => {
    const ratelimiter = createTestingRatelimiter({
      maxRequests: 3,
      window: 1000,
    })

    const test = async (key: string, request: number) => {
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
      Array.from({ length: 5 }, (_, i) => test(`test${i}`, i + 1)),
    )
  })

  describe('cleanup', () => {
    it('should cleanup expired entries on next limit call', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 2,
        window: 200,
      })

      await ratelimiter.limit('test1')
      await ratelimiter.limit('test2')

      // @ts-expect-error accessing private property for testing
      expect(ratelimiter.store.size).toBe(2)

      await sleep(210)

      // Trigger cleanup - test1 should be removed
      await ratelimiter.limit('test2')

      // @ts-expect-error accessing private property for testing
      expect(ratelimiter.store.size).toBe(1)
    })

    it('should handle cleanup with all expired timestamps', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 2,
        window: 150,
      })

      await ratelimiter.limit('test1')
      await sleep(160)

      // @ts-expect-error accessing private property for testing
      ratelimiter.lastCleanupTime = Date.now() - 200

      // Trigger cleanup - test1 has all timestamps expired (idx === -1 branch)
      await ratelimiter.limit('test2')

      // @ts-expect-error accessing private property for testing
      expect(ratelimiter.store.has('test1')).toBe(false)
    })

    it('should handle cleanup with partially expired timestamps', async () => {
      const ratelimiter = createTestingRatelimiter({
        maxRequests: 3,
        window: 150,
      })

      await ratelimiter.limit('test1')
      await sleep(160)
      await ratelimiter.limit('test1')

      // @ts-expect-error accessing private property for testing
      ratelimiter.lastCleanupTime = Date.now() - 200

      // Trigger cleanup - test1 has partial timestamps expired (idx !== -1 branch)
      await ratelimiter.limit('test2')

      // @ts-expect-error accessing private property for testing
      expect(ratelimiter.store.get('test1')?.length).toBe(1)
    })
  })
})
