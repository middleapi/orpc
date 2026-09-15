import type { CacheStore } from '../../src'
import { expect, it, vi } from 'vitest'

/**
 * The behavior every {@link CacheStore} must share, run against one adapter.
 * Adapter suites keep only what is specific to their backend.
 */
export function describeCacheStoreContract(createStore: () => CacheStore): void {
  it('fills a miss once, then serves the entry with its tags', async () => {
    const store = createStore()
    const fill = vi.fn(async () => ({ nested: [1, 2] }))

    await expect(store.getOrSet('k', fill, { tags: ['t'] })).resolves.toEqual({ output: { nested: [1, 2] }, tags: ['t'], expiresAt: undefined })
    await expect(store.getOrSet('k', fill, { tags: ['t'] })).resolves.toEqual({ output: { nested: [1, 2] }, tags: ['t'], expiresAt: undefined })
    expect(fill).toHaveBeenCalledTimes(1)

    await store.getOrSet('u', async () => undefined)
    await expect(store.getOrSet('u', async () => 'refilled')).resolves.toEqual({ output: undefined, tags: undefined, expiresAt: undefined })
  })

  it('fills each key separately', async () => {
    const store = createStore()

    await store.getOrSet('a', async () => 'a')

    await expect(store.getOrSet('b', async () => 'b')).resolves.toMatchObject({ output: 'b' })
    await expect(store.getOrSet('a', async () => 'refilled')).resolves.toMatchObject({ output: 'a' })
  })

  it('preserves Date, Map, Set, and BigInt outputs', async () => {
    const store = createStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
    }

    await store.getOrSet('k', async () => output)

    await expect(store.getOrSet('k', async () => 'refilled')).resolves.toMatchObject({ output })
  })

  it('invalidates entries by any of their tags, leaving others alone', async () => {
    const store = createStore()

    await store.getOrSet('multi', async () => 'v', { tags: ['a', 'b'] })
    await store.getOrSet('other', async () => 'v', { tags: ['c'] })

    await store.revalidate({ tags: ['a'] })

    await expect(store.getOrSet('multi', async () => 'refilled', { tags: ['a', 'b'] })).resolves.toMatchObject({ output: 'refilled' })
    await expect(store.getOrSet('other', async () => 'refilled', { tags: ['c'] })).resolves.toMatchObject({ output: 'v' })
  })

  it('revalidates many tags at once', async () => {
    const store = createStore()

    await store.getOrSet('a', async () => 'v', { tags: ['a'] })
    await store.getOrSet('b', async () => 'v', { tags: ['b'] })

    await store.revalidate({ tags: ['a', 'b'] })

    await expect(store.getOrSet('a', async () => 'refilled', { tags: ['a'] })).resolves.toMatchObject({ output: 'refilled' })
    await expect(store.getOrSet('b', async () => 'refilled', { tags: ['b'] })).resolves.toMatchObject({ output: 'refilled' })
  })

  it('keeps entries filled after a revalidation', async () => {
    const store = createStore()

    await store.getOrSet('k', async () => 'old', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })
    await store.getOrSet('k', async () => 'new', { tags: ['t'] })

    await expect(store.getOrSet('k', async () => 'newer', { tags: ['t'] })).resolves.toMatchObject({ output: 'new' })
  })

  it('fills once for concurrent callers of one key', async () => {
    const store = createStore()
    let finish!: (output: string) => void
    const fill = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve
    }))

    const pending = Promise.all([store.getOrSet('k', fill), store.getOrSet('k', fill), store.getOrSet('k', fill)])
    await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(1), { timeout: 5000 })
    finish('v')

    const entries = await pending
    expect(entries.map(entry => entry.output)).toEqual(['v', 'v', 'v'])
    expect(fill).toHaveBeenCalledTimes(1)
  })

  it('lets a waiter fill when the holder failed to', async () => {
    const store = createStore()
    let fail!: (error: Error) => void
    let started!: () => void
    const holding = new Promise<void>((resolve) => {
      started = resolve
    })

    const first = store.getOrSet('k', () => {
      started()
      return new Promise<never>((_, reject) => {
        fail = reject
      })
    })
    await holding

    const second = store.getOrSet('k', async () => 'fresh')
    fail(new Error('handler down'))

    await expect(first).rejects.toThrow('handler down')
    await expect(second).resolves.toMatchObject({ output: 'fresh' })
  })
}
