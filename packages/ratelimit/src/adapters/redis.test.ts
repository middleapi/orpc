import { sleep } from '@orpc/shared'
import { createClient } from 'redis'
import { RedisRateLimiter } from './redis'

const REDIS_URL = process.env.REDIS_URL

describe.concurrent('redis rate limiter integration', {
  skip: !REDIS_URL,
  timeout: 20_000,
}, async () => {
  const redis = createClient({
    url: REDIS_URL,
  })

  beforeAll(async () => {
    await redis.connect()
  })

  async function createTestingRateLimiter(
    options: ConstructorParameters<typeof RedisRateLimiter>[1] = {
      maxRequests: 3,
      window: 10_000,
    },
  ) {
    return new RedisRateLimiter(redis, {
      prefix: `orpc-redis-rate-limiter-${crypto.randomUUID()}:`,
      ...options,
    })
  }

  it('accepts weighted requests', async () => {
    const limiter = await createTestingRateLimiter()
    const key = 'weighted'

    await expect(
      limiter.limit(key, { weight: 2 }),
    ).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 1,
    })
  })

  it('tracks counters independently for each key', async () => {
    const limiter = await createTestingRateLimiter()

    const aliceKey = 'alice'
    const bobKey = 'bob'

    await expect(
      limiter.limit(aliceKey),
    ).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 2,
    })

    await expect(
      limiter.limit(bobKey),
    ).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 2,
    })
  })

  it('shares counters with limiters created by prefix', async () => {
    const limiter = await createTestingRateLimiter({ maxRequests: 1, window: 10_000 })

    await expect(limiter.limit('tenant:key')).resolves.toMatchObject({ success: true, remaining: 0 })
    await expect(limiter.prefix('tenant:').limit('key')).resolves.toMatchObject({ success: false, remaining: 0 })
    await expect(limiter.prefix('other:').limit('key')).resolves.toMatchObject({ success: true, remaining: 0 })
  })

  it('returns a stable reset timestamp within the same window', async () => {
    const window = 2000
    const limiter = await createTestingRateLimiter({
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

  it('uses an empty prefix when none is provided', async () => {
    const limiter = await createTestingRateLimiter({
      prefix: undefined,
      maxRequests: 3,
      window: 10_000,
    })

    await expect(
      limiter.limit(`no-prefix-${crypto.randomUUID()}`),
    ).resolves.toMatchObject({
      success: true,
      limit: 3,
      remaining: 2,
    })
  })

  it('propagates client errors', async () => {
    const disconnectedRedis = createClient({
      url: 'rediss://invalid',
    })
    const limiter = new RedisRateLimiter(disconnectedRedis, {
      maxRequests: 3,
      window: 10_000,
    })

    await expect(
      limiter.limit('closed-client'),
    ).rejects.toThrow()
  })

  it('rejects invalid weights', async () => {
    const limiter = await createTestingRateLimiter()
    const key = 'invalid-weight'

    await expect(
      limiter.limit(key, { weight: 0 }),
    ).rejects.toThrow(TypeError)

    await expect(
      limiter.limit(key, { weight: -1 }),
    ).rejects.toThrow(TypeError)

    await expect(
      limiter.limit(key, { weight: 1.5 }),
    ).rejects.toThrow(
      'Rate limit weight must be an integer greater than 0',
    )
  })

  it('consumes quota across multiple requests', async () => {
    const limiter = await createTestingRateLimiter()
    const key = 'quota'

    await expect(limiter.limit(key))
      .resolves
      .toMatchObject({
        success: true,
        remaining: 2,
      })

    await expect(limiter.limit(key))
      .resolves
      .toMatchObject({
        success: true,
        remaining: 1,
      })

    await expect(limiter.limit(key))
      .resolves
      .toMatchObject({
        success: true,
        remaining: 0,
      })
  })

  it('rejects requests that exceed the limit', async () => {
    const limiter = await createTestingRateLimiter()
    const key = 'exceeded'

    await limiter.limit(key)
    await limiter.limit(key)
    await limiter.limit(key)

    await expect(
      limiter.limit(key),
    ).resolves.toMatchObject({
      success: false,
      limit: 3,
      remaining: 0,
    })
  })

  it('does not count rejected requests', async () => {
    const limiter = await createTestingRateLimiter({ maxRequests: 5, window: 10_000 })
    const key = 'rejected-not-counted'

    await expect(limiter.limit(key, { weight: 3 })).resolves.toMatchObject({ success: true, remaining: 2 })
    await expect(limiter.limit(key, { weight: 3 })).resolves.toMatchObject({ success: false, remaining: 2 })
    await expect(limiter.limit(key, { weight: 2 })).resolves.toMatchObject({ success: true, remaining: 0 })
    await expect(limiter.limit(key, { weight: 1 })).resolves.toMatchObject({ success: false, remaining: 0 })
  })

  it('does not create a counter for a request heavier than the limit', async () => {
    const prefix = `orpc-redis-rate-limiter-${crypto.randomUUID()}:`
    const limiter = await createTestingRateLimiter({ prefix, maxRequests: 3, window: 10_000 })

    const startedAt = Date.now()
    const result = await limiter.limit('too-heavy', { weight: 4 })

    expect(result).toMatchObject({ success: false, limit: 3, remaining: 3 })
    expect(result.reset).toBeGreaterThan(startedAt)
    await expect(redis.exists(`${prefix}too-heavy`)).resolves.toBe(0)
  })

  it('sets an expiry on a counter that has none', async () => {
    const prefix = `orpc-redis-rate-limiter-${crypto.randomUUID()}:`
    const limiter = await createTestingRateLimiter({ prefix, maxRequests: 3, window: 10_000 })
    const redisKey = `${prefix}no-ttl`

    await redis.set(redisKey, '1')
    await expect(redis.pTTL(redisKey)).resolves.toBe(-1)

    const startedAt = Date.now()
    const result = await limiter.limit('no-ttl')

    expect(result).toMatchObject({ success: true, limit: 3, remaining: 1 })
    expect(result.reset).toBeGreaterThan(startedAt + 5_000)
    await expect(redis.pTTL(redisKey)).resolves.toBeGreaterThan(5_000)
  })

  it('sets an expiry on a full counter that has none', async () => {
    const prefix = `orpc-redis-rate-limiter-${crypto.randomUUID()}:`
    const limiter = await createTestingRateLimiter({ prefix, maxRequests: 3, window: 10_000 })
    const redisKey = `${prefix}full-no-ttl`

    await redis.set(redisKey, '3')

    const startedAt = Date.now()
    const result = await limiter.limit('full-no-ttl')

    expect(result).toMatchObject({ success: false, limit: 3, remaining: 0 })
    expect(result.reset).toBeGreaterThan(startedAt + 5_000)
    await expect(redis.pTTL(redisKey)).resolves.toBeGreaterThan(5_000)
  })

  it('rejects invalid windows', async () => {
    for (const window of [0, -1, 1.5, Number.NaN]) {
      expect(() => new RedisRateLimiter(redis, { maxRequests: 3, window })).toThrow(
        new TypeError('Rate limit window must be an integer greater than 0'),
      )
    }
  })

  describe('timeout', () => {
    it('waits until the next window when capacity is unavailable', async () => {
      const limiter = await createTestingRateLimiter({
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

      expect(Date.now() - start).toBeGreaterThanOrEqual(900)
      expect(result.reset - Date.now()).toBeGreaterThanOrEqual(700)
    })

    it('waits until enough quota is available for weighted requests', async () => {
      const limiter = await createTestingRateLimiter({
        maxRequests: 2,
        window: 1000,
        timeout: 4000,
      })

      const key = 'blocking-weighted'

      await expect(
        limiter.limit(key),
      ).resolves.toMatchObject({
        success: true,
        remaining: 1,
      })

      await sleep(100)

      await expect(
        limiter.limit(key, { weight: 2 }),
      ).resolves.toMatchObject({
        success: true,
        limit: 2,
        remaining: 0,
      })
    })

    it('gives up right away when the weight exceeds the limit', async () => {
      const limiter = await createTestingRateLimiter({
        maxRequests: 2,
        window: 1000,
        timeout: 4000,
      })

      const start = Date.now()

      await expect(
        limiter.limit('blocking-too-heavy', { weight: 3 }),
      ).resolves.toMatchObject({
        success: false,
        limit: 2,
        remaining: 2,
      })

      expect(Date.now() - start).toBeLessThan(500)
    })

    it('returns denial when reset exceeds timeout', async () => {
      const limiter = await createTestingRateLimiter({
        maxRequests: 2,
        window: 10_000,
        timeout: 100,
      })

      const key = 'blocking-timeout'

      await limiter.limit(key)

      await sleep(100)

      await expect(
        limiter.limit(key, { weight: 2 }),
      ).resolves.toMatchObject({
        success: false,
        limit: 2,
        remaining: 1,
      })
    })
  })

  it('lazily connects to Redis once under concurrent limit calls', async () => {
    const redis = createClient({
      url: REDIS_URL,
    })

    const limiter = new RedisRateLimiter(redis, {
      prefix: `orpc-redis-rate-limiter-${crypto.randomUUID()}:`,
      maxRequests: 4,
      window: 10,
    })

    expect(redis.isOpen).toBe(false)

    await Promise.all([
      expect(limiter.limit('key')).resolves.toMatchObject({ success: true }),
      expect(limiter.limit('key')).resolves.toMatchObject({ success: true }),
      expect(limiter.limit('key')).resolves.toMatchObject({ success: true }),
      expect(limiter.limit('key')).resolves.toMatchObject({ success: true }),
    ])

    expect(redis.isOpen).toBe(true)
  })
})
