import type { CacheStore } from '../../src'
import { expect, it, vi } from 'vitest'

/**
 * The behavior every {@link CacheStore} must share, run against one adapter.
 * Adapter suites keep only what is specific to their backend.
 */
export function describeCacheStoreContract(createStore: () => CacheStore): void {
  it('round-trips outputs with their tags, including undefined', async () => {
    const store = createStore()

    await store.set('k', { nested: [1, 2] }, { tags: ['t'] })
    await expect(store.get('k')).resolves.toEqual({ output: { nested: [1, 2] }, tags: ['t'], expiresAt: undefined })

    await store.set('u', undefined)
    await expect(store.get('u')).resolves.toEqual({ output: undefined, tags: undefined, expiresAt: undefined })
  })

  it('misses on unknown keys', async () => {
    const store = createStore()

    await expect(store.get('unknown')).resolves.toBeUndefined()
  })

  it('preserves Date, Map, Set, and BigInt outputs', async () => {
    const store = createStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
    }

    await store.set('k', output)

    await expect(store.get('k')).resolves.toMatchObject({ output })
  })

  it('invalidates entries by any of their tags, leaving others alone', async () => {
    const store = createStore()

    await store.set('multi', 'v', { tags: ['a', 'b'] })
    await store.set('other', 'v', { tags: ['c'] })

    await store.revalidate({ tags: ['a'] })

    await expect(store.get('multi')).resolves.toBeUndefined()
    await expect(store.get('other')).resolves.toBeDefined()
  })

  it('revalidates many tags at once', async () => {
    const store = createStore()

    await store.set('a', 'v', { tags: ['a'] })
    await store.set('b', 'v', { tags: ['b'] })

    await store.revalidate({ tags: ['a', 'b'] })

    await expect(store.get('a')).resolves.toBeUndefined()
    await expect(store.get('b')).resolves.toBeUndefined()
  })

  it('keeps entries set after a revalidation', async () => {
    const store = createStore()

    await store.set('k', 'old', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })
    await store.set('k', 'new', { tags: ['t'] })

    await expect(store.get('k')).resolves.toMatchObject({ output: 'new' })
  })

  it('runs lock callbacks one key at a time, telling later callers they waited', async () => {
    const store = createStore()
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = store.lock!('k', async (waited) => {
      order.push(`first:${waited}`)
      await held
      return 'first'
    })
    await vi.waitFor(() => expect(order).toEqual(['first:false']), { timeout: 5000 })

    const second = store.lock!('k', async (waited) => {
      order.push(`second:${waited}`)
      return 'second'
    })

    // Other keys are independent of the held one.
    await expect(store.lock!('other', async waited => waited)).resolves.toBe(false)
    expect(order).toEqual(['first:false'])

    release()

    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first:false', 'second:true'])
  })

  it('hands the lock on when the holder throws', async () => {
    const store = createStore()
    let fail!: (error: Error) => void
    let acquired!: () => void
    const holding = new Promise<void>((resolve) => {
      acquired = resolve
    })

    const first = store.lock!('k', async () => {
      acquired()
      await new Promise<never>((_, reject) => {
        fail = reject
      })
    })
    await holding

    const second = store.lock!('k', async waited => waited)

    fail(new Error('boom'))

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe(true)
    await expect(store.lock!('k', async waited => waited)).resolves.toBe(false)
  })
}
