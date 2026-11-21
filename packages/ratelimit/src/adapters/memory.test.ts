import { MemoryRateLimiter } from './memory'

describe('memoryRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit, then starts denying', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 3, window: 1000 })

    expect(await limiter.limit('key')).toEqual({
      success: true,
      limit: 3,
      remaining: 2,
      reset: 1000,
    })
    expect(await limiter.limit('key')).toEqual({
      success: true,
      limit: 3,
      remaining: 1,
      reset: 1000,
    })
    expect(await limiter.limit('key')).toEqual({
      success: true,
      limit: 3,
      remaining: 0,
      reset: 1000,
    })
    expect(await limiter.limit('key')).toEqual({
      success: false,
      limit: 3,
      remaining: 0,
      reset: 1000,
    })
  })

  it('consumes weight and denies when accumulated weight exceeds the limit', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 5, window: 1000 })

    expect(await limiter.limit('key', { weight: 3 })).toEqual({
      success: true,
      limit: 5,
      remaining: 2,
      reset: 1000,
    })
    expect(await limiter.limit('key', { weight: 3 })).toEqual({
      success: false,
      limit: 5,
      remaining: 2,
      reset: 1000,
    })
    expect(await limiter.limit('key', { weight: 2 })).toEqual({
      success: true,
      limit: 5,
      remaining: 0,
      reset: 1000,
    })
    expect(await limiter.limit('key', { weight: 1 })).toEqual({
      success: false,
      limit: 5,
      remaining: 0,
      reset: 1000,
    })
  })

  it('tracks limits independently per key', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 1, window: 1000 })

    expect(await limiter.limit('alice')).toEqual({
      success: true,
      limit: 1,
      remaining: 0,
      reset: 1000,
    })
    expect(await limiter.limit('alice')).toEqual({
      success: false,
      limit: 1,
      remaining: 0,
      reset: 1000,
    })
    expect(await limiter.limit('bob')).toEqual({
      success: true,
      limit: 1,
      remaining: 0,
      reset: 1000,
    })
  })

  it('starts each key window at that key first hit', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 1, window: 1000 })

    expect(await limiter.limit('alice')).toMatchObject({ success: true, reset: 1000 })

    vi.setSystemTime(400)
    expect(await limiter.limit('bob')).toMatchObject({ success: true, reset: 1400 })

    vi.setSystemTime(1000) // alice's window is over, bob's is not
    expect(await limiter.limit('alice')).toMatchObject({ success: true, reset: 2000 })
    expect(await limiter.limit('bob')).toMatchObject({ success: false, reset: 1400 })

    vi.setSystemTime(1400)
    expect(await limiter.limit('bob')).toMatchObject({ success: true, reset: 2400 })
  })

  it('does not count rejected requests', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 3, window: 1000 })

    expect(await limiter.limit('key', { weight: 2 })).toMatchObject({ success: true, remaining: 1 })

    for (let i = 0; i < 5; i++) {
      expect(await limiter.limit('key', { weight: 2 })).toEqual({
        success: false,
        limit: 3,
        remaining: 1,
        reset: 1000,
      })
    }

    expect(await limiter.limit('key')).toMatchObject({ success: true, remaining: 0 })
  })

  it('does not start a window for a request that can never fit', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 2, window: 1000 })

    expect(await limiter.limit('key', { weight: 3 })).toEqual({
      success: false,
      limit: 2,
      remaining: 2,
      reset: 1000,
    })
    expect((limiter as any).entries.size).toBe(0)

    vi.setSystemTime(500)
    expect(await limiter.limit('key', { weight: 2 })).toMatchObject({ success: true, reset: 1500 })
  })

  it('denies within window and resets counter on new window', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 2, window: 1000 })

    expect(await limiter.limit('key')).toEqual({
      success: true,
      limit: 2,
      remaining: 1,
      reset: 1000,
    })
    expect(await limiter.limit('key')).toEqual({
      success: true,
      limit: 2,
      remaining: 0,
      reset: 1000,
    })

    await vi.advanceTimersByTimeAsync(999) // still inside window
    expect(await limiter.limit('key')).toEqual({
      success: false,
      limit: 2,
      remaining: 0,
      reset: 1000,
    })

    await vi.advanceTimersByTimeAsync(1) // t=1000 — new window
    expect(await limiter.limit('key', { weight: 2 })).toEqual({
      success: true,
      limit: 2,
      remaining: 0,
      reset: 2000,
    })
    expect(await limiter.limit('key')).toEqual({
      success: false,
      limit: 2,
      remaining: 0,
      reset: 2000,
    })
  })

  it('reset is pegged to window start and does not shift mid-window', async () => {
    vi.setSystemTime(200)
    const limiter = new MemoryRateLimiter({ maxRequests: 3, window: 1000 })

    expect(await limiter.limit('key', { weight: 2 })).toEqual({
      success: true,
      limit: 3,
      remaining: 1,
      reset: 1200,
    })
    vi.setSystemTime(500)
    expect(await limiter.limit('key', { weight: 1 })).toEqual({
      success: true,
      limit: 3,
      remaining: 0,
      reset: 1200,
    })
    vi.setSystemTime(600)
    expect(await limiter.limit('key', { weight: 2 })).toEqual({
      success: false,
      limit: 3,
      remaining: 0,
      reset: 1200,
    })
  })

  it('throws for invalid weights', async () => {
    const limiter = new MemoryRateLimiter({ maxRequests: 5, window: 1000 })

    await expect(limiter.limit('key', { weight: 0 })).rejects.toThrow(TypeError)
    await expect(limiter.limit('key', { weight: -1 })).rejects.toThrow(TypeError)
    await expect(limiter.limit('key', { weight: 1.5 })).rejects.toThrow(
      'Rate limit weight must be an integer greater than 0',
    )
  })

  it('should not allow more than maxRequests under concurrent requests', async () => {
    const limiter = new MemoryRateLimiter({
      maxRequests: 10,
      window: 1000,
    })

    const results = await Promise.all(Array.from({ length: 100 }, () => limiter.limit('user')))

    const successCount = results.filter((r) => r.success).length

    expect(successCount).toBe(10)
    expect(results.length - successCount).toBe(90)
  })

  describe('timeout', () => {
    it('blocks and retries until a slot opens up', async () => {
      const limiter = new MemoryRateLimiter({
        maxRequests: 1,
        window: 500,
        timeout: 1000,
      })

      expect(await limiter.limit('key')).toEqual({
        success: true,
        limit: 1,
        remaining: 0,
        reset: 500,
      })

      const pending = limiter.limit('key')
      await vi.advanceTimersByTimeAsync(500) // new window at t=500

      expect(await pending).toEqual({ success: true, limit: 1, remaining: 0, reset: 1000 })
    })

    it('blocks and retries with weight until a slot opens up', async () => {
      const limiter = new MemoryRateLimiter({
        maxRequests: 3,
        window: 500,
        timeout: 1000,
      })

      expect(await limiter.limit('key', { weight: 3 })).toEqual({
        success: true,
        limit: 3,
        remaining: 0,
        reset: 500,
      })

      const pending = limiter.limit('key', { weight: 2 })
      await vi.advanceTimersByTimeAsync(500) // new window at t=500

      expect(await pending).toEqual({ success: true, limit: 3, remaining: 1, reset: 1000 })
    })

    it('does not consume quota while waiting', async () => {
      const limiter = new MemoryRateLimiter({
        maxRequests: 2,
        window: 500,
        timeout: 1000,
      })

      expect(await limiter.limit('key', { weight: 2 })).toMatchObject({ success: true })

      const pending = [limiter.limit('key'), limiter.limit('key')]
      await vi.advanceTimersByTimeAsync(500)

      expect(await Promise.all(pending)).toEqual([
        { success: true, limit: 2, remaining: 1, reset: 1000 },
        { success: true, limit: 2, remaining: 0, reset: 1000 },
      ])
    })

    it('gives up immediately when the wait would exceed the timeout', async () => {
      const limiter = new MemoryRateLimiter({
        maxRequests: 1,
        window: 2000,
        timeout: 100,
      })

      expect(await limiter.limit('key')).toEqual({
        success: true,
        limit: 1,
        remaining: 0,
        reset: 2000,
      })

      const pending = limiter.limit('key')
      await vi.advanceTimersByTimeAsync(200)

      expect(await pending).toEqual({ success: false, limit: 1, remaining: 0, reset: 2000 })
    })

    it('does not block when timeout is 0', async () => {
      const limiter = new MemoryRateLimiter({
        maxRequests: 1,
        window: 1000,
        timeout: 0,
      })

      expect(await limiter.limit('key')).toEqual({
        success: true,
        limit: 1,
        remaining: 0,
        reset: 1000,
      })
      expect(await limiter.limit('key')).toEqual({
        success: false,
        limit: 1,
        remaining: 0,
        reset: 1000,
      })
    })
  })

  describe('cleanup', () => {
    it('drops expired keys from memory', async () => {
      const limiter = new MemoryRateLimiter({ maxRequests: 5, window: 1000 })

      await limiter.limit('key1')
      await vi.advanceTimersByTimeAsync(500)
      await limiter.limit('key2')
      expect((limiter as any).entries.size).toBe(2)

      await vi.advanceTimersByTimeAsync(500) // t=1000 — key1 expired, key2 did not
      await limiter.limit('other') // triggers a sweep
      expect([...(limiter as any).entries.keys()]).toEqual(['key2', 'other'])

      await vi.advanceTimersByTimeAsync(1000) // t=2000 — everything expired
      await limiter.limit('key2')
      expect([...(limiter as any).entries.keys()]).toEqual(['key2'])
    })
  })
})
