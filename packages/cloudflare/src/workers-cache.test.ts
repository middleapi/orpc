import { describe, expect, it, vi } from 'vitest'
import { experimental_WorkersCacheStore } from './workers-cache'

describe('experimental_WorkersCacheStore', () => {
  const createPurger = () => ({
    purge: vi.fn(async () => ({ success: true })),
  })

  it('always misses and stores nothing', async () => {
    const purger = createPurger()
    const store = new experimental_WorkersCacheStore({ cache: purger })

    await store.set('k', 'v', { tags: ['t'], ttl: 1000 })
    await expect(store.get('k')).resolves.toBeUndefined()
    expect(purger.purge).not.toHaveBeenCalled()
  })

  it('purges encoded tags through workers caching', async () => {
    const purger = createPurger()
    const store = new experimental_WorkersCacheStore({ cache: purger })

    await store.revalidate({ tags: ['planets', 'a,b'] })

    expect(purger.purge).toHaveBeenCalledTimes(1)
    expect(purger.purge).toHaveBeenCalledWith({ tags: ['planets', 'a%2Cb'] })
  })

  it('throws a bare error when the purge fails without messages', async () => {
    const purger = {
      purge: vi.fn(async () => ({ success: false })),
    }
    const store = new experimental_WorkersCacheStore({ cache: purger })

    await expect(store.revalidate({ tags: ['planets'] })).rejects.toThrow(
      'experimental_WorkersCacheStore failed to purge tags',
    )
  })

  it('throws when the purge fails, including error messages', async () => {
    const purger = {
      purge: vi.fn(async () => ({ success: false, errors: [{ code: 429, message: 'Rate limited' }] })),
    }
    const store = new experimental_WorkersCacheStore({ cache: purger })

    await expect(store.revalidate({ tags: ['planets'] })).rejects.toThrow(
      'experimental_WorkersCacheStore failed to purge tags: Rate limited',
    )
  })
})
