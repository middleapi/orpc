import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext, CacheEntry, CacheStore } from './types'
import { call, os, type } from '@orpc/server'
import { nowInSeconds } from '@orpc/shared'
import { MemoryCacheStore } from './adapters/memory'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'
import { cache, revalidate } from './middleware'

/**
 * A store that serves `entry` when given, and otherwise fills like a miss.
 */
function createStore(entry?: CacheEntry) {
  return {
    getOrSet: vi.fn<CacheStore['getOrSet']>(async (_key, fill, options) => entry ?? {
      output: await fill(),
      tags: options?.tags,
      expiresAt: options?.ttl !== undefined ? nowInSeconds() + options.ttl : undefined,
      evictAt: options?.ttl !== undefined ? nowInSeconds() + options.ttl + (options.swr ?? 0) : undefined,
    }),
    revalidate: vi.fn<CacheStore['revalidate']>().mockResolvedValue(undefined),
  }
}

describe('cache', () => {
  it('fills through the store on miss and returns the output', async () => {
    const store = createStore()
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os
      .$context<CacheContext>()
      .use(cache({ key: 'k', tags: ['t1', 't2'], ttl: 60, swr: 30 }))
      .handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).resolves.toBe('fresh')

    expect(handlerFn).toHaveBeenCalledTimes(1)
    expect(store.getOrSet).toHaveBeenCalledWith('k', expect.any(Function), { tags: ['t1', 't2'], ttl: 60, swr: 30, waitUntil: undefined })
  })

  describe('key derivation', () => {
    it('derives the key from the procedure path and input by default', async () => {
      const store = createStore()
      const procedure = os.$context<CacheContext>().input(type<any>()).use(cache()).handler(() => 'ok')

      await call(procedure, { id: 1 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(procedure, { id: 1 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(procedure, { id: 2 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(procedure, { id: 1 }, { context: { 'cache/store': store }, path: ['user', 'find'] })

      const keys = store.getOrSet.mock.calls.map(([key]) => key)
      expect(keys[0]).toEqual([['planet', 'find'], { id: 1 }]) // the procedure path and input
      expect(keys[0]).toEqual(keys[1]) // same path + input
      expect(keys[0]).not.toEqual(keys[2]) // different input
      expect(keys[0]).not.toEqual(keys[3]) // different path
    })

    it('uses a provided key as-is, whatever its type', async () => {
      const store = createStore()
      const material = os
        .$context<CacheContext>()
        .input(type<any>())
        .use(cache({ key: (_, input) => ({ id: input.id }) }))
        .handler(() => 'ok')
      const verbatim = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => 'ok')

      await call(material, { id: 1, page: 1 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(material, { id: 1, page: 2 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(verbatim, undefined, { context: { 'cache/store': store } })

      const keys = store.getOrSet.mock.calls.map(([key]) => key)
      expect(keys[0]).toEqual({ id: 1 }) // the resolved material, not combined with the path
      expect(keys[0]).toEqual(keys[1]) // same material despite different inputs
      expect(keys[2]).toBe('k')
    })

    it('derives the default key from the full input when input schemas are stacked', async () => {
      const store = createStore()
      const procedure = os
        .$context<CacheContext>()
        .input(type<{ id: number }>(raw => ({ id: (raw as any).id })))
        .use(cache())
        .input(type<{ page: number }>(raw => ({ page: (raw as any).page })))
        .handler(() => 'ok')

      await call(procedure, { id: 1, page: 1 } as any, { context: { 'cache/store': store } })
      await call(procedure, { id: 1, page: 2 } as any, { context: { 'cache/store': store } })

      // The middleware only validated `id` at its position, but the key still
      // covers the full input, so different pages never share an entry.
      const keys = store.getOrSet.mock.calls.map(([key]) => key)
      expect(keys[0]).not.toEqual(keys[1])
    })
  })

  it.each<[string, CacheEntry, unknown]>([
    ['a fresh entry', { output: 'cached', tags: ['t'], expiresAt: nowInSeconds() + 60 }, 'cached'],
    ['an entry that never expires', { output: 'cached', tags: [] }, 'cached'],
    ['a cached undefined output', { output: undefined, tags: [] }, undefined],
  ])('serves %s without running the handler', async (_, entry, expected) => {
    const store = createStore(entry)
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).resolves.toBe(expected)

    expect(handlerFn).not.toHaveBeenCalled()
  })

  it('key, tags, ttl, swr, enabled can be async functions', async () => {
    const store = createStore()
    const keyFn = vi.fn().mockResolvedValueOnce('k')
    const tagsFn = vi.fn().mockResolvedValueOnce(['t'])
    const ttlFn = vi.fn().mockResolvedValueOnce(60)
    const swrFn = vi.fn().mockResolvedValueOnce(30)
    const enabledFn = vi.fn().mockResolvedValueOnce(true)
    const mw = cache({ key: keyFn, tags: tagsFn, ttl: ttlFn, swr: swrFn, enabled: enabledFn })
    const procedure = os.$context<CacheContext>().input(type<{ id: number }>()).use(mw).handler(() => 'fresh')

    await expect(
      call(procedure, { id: 1 }, { context: { 'cache/store': store } }),
    ).resolves.toBe('fresh')

    for (const fn of [keyFn, tagsFn, ttlFn, swrFn, enabledFn]) {
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ context: expect.any(Object) }), { id: 1 })
    }
    expect(store.getOrSet).toHaveBeenCalledWith('k', expect.any(Function), { tags: ['t'], ttl: 60, swr: 30, waitUntil: undefined })
  })

  it('skips the store when enabled resolves to false', async () => {
    const store = createStore({ output: 'cached', tags: [] })
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k', enabled: false })).handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).resolves.toBe('fresh')

    expect(handlerFn).toHaveBeenCalledTimes(1)
    expect(store.getOrSet).not.toHaveBeenCalled()
  })

  it('hands cache/waitUntil to the store', async () => {
    const store = createStore()
    const waitUntil = vi.fn()
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => 'fresh')

    await call(procedure, undefined, { context: { 'cache/store': store, 'cache/waitUntil': waitUntil } })

    expect(store.getOrSet).toHaveBeenCalledWith('k', expect.any(Function), expect.objectContaining({ waitUntil }))
  })

  it('records the entry into the handler plugin context with its remaining ttl and swr', async () => {
    const now = nowInSeconds()
    const stale = createStore({ output: 'stale', tags: ['stored'], expiresAt: now - 10, evictAt: now + 20 })
    const fresh = createStore({ output: 'fresh', tags: ['stored'], expiresAt: now + 60, evictAt: now + 90 })
    const pluginContext: Exclude<CacheHandlerPluginContext[typeof CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined> = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k', tags: ['t'], swr: 30 }))
      .handler(() => 'filled')
    const context = { [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext }

    await call(procedure, undefined, { context: { 'cache/store': stale, ...context }, path: ['__path__'] })
    await call(procedure, undefined, { context: { 'cache/store': fresh, ...context }, path: ['__path__'] })
    await call(procedure, undefined, { context: { 'cache/store': createStore(), ...context }, path: ['__path__'] })

    // Only what is left of each window is reflected, so headers never outlive the entry.
    expect(pluginContext.caches.map(({ ttl, swr }) => ({ ttl, swr }))).toEqual([
      { ttl: 0, swr: expect.closeTo(20, -1) },
      { ttl: expect.closeTo(60, -1), swr: 30 },
      { ttl: undefined, swr: undefined },
    ])
    expect(pluginContext.caches.map(({ tags }) => tags)).toEqual([['stored'], ['stored'], ['t']])
  })

  it('records stacked caches in lookup order, on misses and hits alike', async () => {
    const store = new MemoryCacheStore()
    const pluginContext: Exclude<CacheHandlerPluginContext[typeof CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined> = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'outer', tags: ['outer'] }))
      .use(cache({ key: 'inner', tags: ['inner'] }))
      .handler(() => 'v')
    const context = { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext }

    await call(procedure, undefined, { context })
    expect(pluginContext.caches.map(({ tags }) => tags)).toEqual([['outer'], ['inner']])

    await call(procedure, undefined, { context })
    expect(pluginContext.caches.map(({ tags }) => tags)).toEqual([['outer'], ['inner'], ['outer']])
  })

  it('propagates store failures and records no check', async () => {
    const store = createStore()
    store.getOrSet.mockRejectedValueOnce(new Error('store down'))
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os.$context<CacheContext & CacheHandlerPluginContext>().use(cache({ key: 'k' })).handler(() => 'fresh')

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext } }),
    ).rejects.toThrow('store down')

    expect(pluginContext.caches).toEqual([])
  })

  describe('with the memory store', () => {
    it('runs the handler once for concurrent misses', async () => {
      const store = new MemoryCacheStore()
      let finish!: (output: string) => void
      const handlerFn = vi.fn(() => new Promise<string>((resolve) => {
        finish = resolve
      }))
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(handlerFn)
      const run = () => call(procedure, undefined, { context: { 'cache/store': store } })

      const results = Promise.all([run(), run(), run()])
      await vi.waitFor(() => expect(handlerFn).toHaveBeenCalledTimes(1))
      finish('fresh')

      await expect(results).resolves.toEqual(['fresh', 'fresh', 'fresh'])
      expect(handlerFn).toHaveBeenCalledTimes(1)
    })

    it('serves concurrent stale hits immediately and refreshes once through waitUntil', async () => {
      const store = new MemoryCacheStore()
      await store.getOrSet('k', async () => 'stale', { ttl: 0, swr: 60 })

      let finish!: (output: string) => void
      const handlerFn = vi.fn(() => new Promise<string>((resolve) => {
        finish = resolve
      }))
      const waitUntil = vi.fn()
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k', ttl: 60 })).handler(handlerFn)
      const run = () => call(procedure, undefined, { context: { 'cache/store': store, 'cache/waitUntil': waitUntil } })

      await expect(Promise.all([run(), run()])).resolves.toEqual(['stale', 'stale'])
      expect(waitUntil).toHaveBeenCalledTimes(2)

      finish('fresh')
      await Promise.all(waitUntil.mock.calls.map(([refresh]) => refresh))
      expect(handlerFn).toHaveBeenCalledTimes(1)

      await expect(run()).resolves.toBe('fresh')
    })

    it('leaves refresh failures unhandled without waitUntil', async ({ onTestFinished }) => {
      // Vitest reports unhandled rejections as failures, so its listeners step aside for this test.
      const listeners = process.rawListeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[]
      process.removeAllListeners('unhandledRejection')
      const unhandledRejectionHandler = vi.fn()
      process.on('unhandledRejection', unhandledRejectionHandler)

      onTestFinished(() => {
        process.off('unhandledRejection', unhandledRejectionHandler)
        for (const listener of listeners) {
          process.on('unhandledRejection', listener)
        }
      })

      const store = new MemoryCacheStore()
      await store.getOrSet('k', async () => 'stale', { ttl: 0, swr: 60 })
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => {
        throw new Error('handler down')
      })

      await expect(
        call(procedure, undefined, { context: { 'cache/store': store } }),
      ).resolves.toBe('stale')

      await vi.waitFor(() => expect(unhandledRejectionHandler).toHaveBeenCalledWith(new Error('handler down'), expect.any(Promise)))
    })
  })
})

describe('revalidate', () => {
  it('revalidates tags after the handler succeeds', async () => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const order: string[] = []
    store.revalidate.mockImplementation(async () => {
      order.push('revalidate')
    })
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(revalidate({ tags: ['t1', 't2'] }))
      .handler(() => {
        order.push('handler')
        return 'done'
      })

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext }, path: ['__path__'] }),
    ).resolves.toBe('done')

    expect(order).toEqual(['handler', 'revalidate'])
    expect(store.revalidate).toHaveBeenCalledWith({ tags: ['t1', 't2'] })
    expect(pluginContext.revalidations).toEqual([{ procedure, path: ['__path__'], tags: ['t1', 't2'] }])
  })

  it('tags can be an async function', async () => {
    const store = createStore()
    const tagsFn = vi.fn().mockResolvedValueOnce(['t'])
    const procedure = os.$context<CacheContext>().input(type<{ id: number }>()).use(revalidate({ tags: tagsFn })).handler(() => 'done')

    await call(procedure, { id: 1 }, { context: { 'cache/store': store } })

    expect(tagsFn).toHaveBeenCalledWith(expect.objectContaining({ context: expect.any(Object) }), { id: 1 })
    expect(store.revalidate).toHaveBeenCalledWith({ tags: ['t'] })
  })

  it('skips the revalidation when the handler throws', async () => {
    const store = createStore()
    const procedure = os.$context<CacheContext>().use(revalidate({ tags: ['t'] })).handler(() => {
      throw new Error('handler down')
    })

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).rejects.toThrow('handler down')

    expect(store.revalidate).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('skips the revalidation when tags resolve to %s', async (_, tags) => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os.$context<CacheContext & CacheHandlerPluginContext>().use(revalidate({ tags: () => tags })).handler(() => 'done')

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext } }),
    ).resolves.toBe('done')

    expect(store.revalidate).not.toHaveBeenCalled()
    expect(pluginContext.revalidations).toEqual([])
  })
})

describe('cache + revalidate combined', () => {
  it('never serves an entry whose own fill revalidated one of its tags', async () => {
    const store = new MemoryCacheStore()
    const revalidateSpy = vi.spyOn(store, 'revalidate')
    const handlerFn = vi.fn(() => 'fresh')
    const procedure = os
      .$context<CacheContext>()
      .use(cache({ key: 'k', tags: ['t'] }))
      .use(revalidate({ tags: ['t'] }))
      .handler(handlerFn)
    const run = () => call(procedure, undefined, { context: { 'cache/store': store } })

    // The tag was captured before the fill and bumped during it, so the entry is invalid on arrival.
    await expect(run()).resolves.toBe('fresh')
    await expect(run()).resolves.toBe('fresh')

    expect(handlerFn).toHaveBeenCalledTimes(2)
    expect(revalidateSpy).toHaveBeenCalledTimes(2)
  })
})
