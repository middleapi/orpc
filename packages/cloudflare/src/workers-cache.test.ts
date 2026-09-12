import { nowInSeconds } from '@orpc/shared'
import { cache } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { experimental_WorkersCacheStore } from './workers-cache'

describe('experimental_WorkersCacheStore', () => {
  const createPurger = () => ({
    purge: vi.fn(async () => ({ success: true })),
  }) as any

  it('fills every time and stores nothing', async () => {
    const purger = createPurger()
    const store = new experimental_WorkersCacheStore({ cache: purger })
    const fill = vi.fn(async () => 'v')

    const entry = await store.getOrSet('k', fill, { tags: ['t'], ttl: 1000 })
    expect(entry.output).toBe('v')
    expect(entry.tags).toEqual(['t'])
    expect(entry.expiresAt).toBeGreaterThan(nowInSeconds())

    await expect(store.getOrSet('k', fill)).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: undefined })
    expect(fill).toHaveBeenCalledTimes(2)
    expect(purger.purge).not.toHaveBeenCalled()
  })

  it('measures expiry from when the fill finishes', async () => {
    const store = new experimental_WorkersCacheStore({ cache: createPurger() })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000)

    const entry = await store.getOrSet('k', async () => {
      now.mockReturnValue(1_000_000_005_000)
      return 'v'
    }, { ttl: 10 })

    expect(entry.expiresAt).toBe(1_000_000_015)
    now.mockRestore()
  })

  it('purges encoded tags through workers caching', async () => {
    const purger = createPurger()
    const store = new experimental_WorkersCacheStore({ cache: purger })

    await store.revalidate({ tags: ['planets', 'a,b'] })

    expect(purger.purge).toHaveBeenCalledTimes(1)
    expect(purger.purge).toHaveBeenCalledWith({ tags: ['planets', 'a%2Cb'] })
  })

  it('defaults to the cache exported by cloudflare:workers', () => {
    const store = new experimental_WorkersCacheStore()

    expect((store as any).cache).toBe(cache)
  })

  it('throws a bare error when the purge fails without messages', async () => {
    const store = new experimental_WorkersCacheStore({
      cache: {
        purge: vi.fn(async () => ({ success: false })) as any,
      },
    })

    await expect(store.revalidate({ tags: ['planets'] })).rejects.toThrow(
      'experimental_WorkersCacheStore failed to purge tags',
    )
  })

  it('throws when the purge fails, including error messages', async () => {
    const store = new experimental_WorkersCacheStore({
      cache: {
        purge: vi.fn(async () => ({ success: false, errors: [{ code: 429, message: 'Rate limited' }] })),
      },
    })

    await expect(store.revalidate({ tags: ['planets'] })).rejects.toThrow(
      'experimental_WorkersCacheStore failed to purge tags: Rate limited',
    )
  })
})
