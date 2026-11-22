import { BaseRedisRateLimiter } from './base-redis'

class TestingRateLimiter extends BaseRedisRateLimiter {
  evalScript = vi.fn<(script: string, keys: string[], args: string[]) => Promise<unknown>>()
}

describe('baseRedisRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the weight, window and limit, so the script can check before it consumes', async () => {
    const limiter = new TestingRateLimiter({ maxRequests: 5, window: 1000, prefix: 'app:' })
    limiter.evalScript.mockResolvedValueOnce([1, 2, 1000])

    await expect(limiter.limit('key', { weight: 2 })).resolves.toEqual({
      success: true,
      limit: 5,
      remaining: 3,
      reset: 11_000,
    })

    expect(limiter.evalScript).toHaveBeenCalledTimes(1)
    expect(limiter.evalScript).toHaveBeenCalledWith(
      expect.any(String),
      ['app:key'],
      ['2', '1000', '5'],
    )
  })

  it('reports a rejection from the script with the untouched counter', async () => {
    const limiter = new TestingRateLimiter({ maxRequests: 5, window: 1000 })
    limiter.evalScript.mockResolvedValueOnce([0, 4, 300])

    await expect(limiter.limit('key', { weight: 2 })).resolves.toEqual({
      success: false,
      limit: 5,
      remaining: 1,
      reset: 10_300,
    })
  })

  it('uses an empty prefix when none is provided', async () => {
    const limiter = new TestingRateLimiter({ maxRequests: 5, window: 1000 })
    limiter.evalScript.mockResolvedValueOnce([1, 1, 1000])

    await limiter.limit('key')

    expect(limiter.evalScript).toHaveBeenCalledWith(expect.any(String), ['key'], expect.any(Array))
  })

  it('retries after the window resets when a timeout is set', async () => {
    const limiter = new TestingRateLimiter({ maxRequests: 1, window: 500, timeout: 1000 })
    limiter.evalScript.mockResolvedValueOnce([0, 1, 200]).mockResolvedValueOnce([1, 1, 500])

    const pending = limiter.limit('key')
    await vi.advanceTimersByTimeAsync(200)

    await expect(pending).resolves.toEqual({
      success: true,
      limit: 1,
      remaining: 0,
      reset: 10_700,
    })
    expect(limiter.evalScript).toHaveBeenCalledTimes(2)
  })
})
