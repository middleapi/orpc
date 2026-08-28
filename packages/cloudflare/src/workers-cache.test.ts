import { describe, expect, it, vi } from 'vitest'
import { WorkersCacheStore } from './workers-cache'

describe('workersCacheStore', () => {
  const createPurger = () => ({
    purge: vi.fn(async () => ({ success: true })),
  })

  it('always misses and stores nothing', async () => {
    const purger = createPurger()
    const store = new WorkersCacheStore(purger)

    await store.set('k', 'v', { tags: ['t'], ttl: 1000 })
    await expect(store.get('k')).resolves.toBeUndefined()
    expect(purger.purge).not.toHaveBeenCalled()
  })

  it('purges encoded tags through workers caching', async () => {
    const purger = createPurger()
    const store = new WorkersCacheStore(purger)

    await store.revalidateTag(['planets', 'a,b'])

    expect(purger.purge).toHaveBeenCalledTimes(1)
    expect(purger.purge).toHaveBeenCalledWith({ tags: ['planets', 'a%2Cb'] })
  })

  it('accepts a single tag', async () => {
    const purger = createPurger()
    const store = new WorkersCacheStore(purger)

    await store.revalidateTag('planets')

    expect(purger.purge).toHaveBeenCalledWith({ tags: ['planets'] })
  })

  it('throws when the purge fails, including error messages', async () => {
    const purger = {
      purge: vi.fn(async () => ({ success: false, errors: [{ code: 429, message: 'Rate limited' }] })),
    }
    const store = new WorkersCacheStore(purger)

    await expect(store.revalidateTag('planets')).rejects.toThrow(
      'WorkersCacheStore failed to purge tags: Rate limited',
    )
  })
})
