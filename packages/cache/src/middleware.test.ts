import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext, CacheEntry, CacheStore } from './types'
import { call, os, type } from '@orpc/server'
import { nowInSeconds } from '@orpc/shared'
import { MemoryCacheStore } from './adapters/memory'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'
import { cache, revalidate } from './middleware'

function createStore(entry?: CacheEntry) {
  return {
    get: vi.fn<CacheStore['get']>().mockResolvedValue(entry),
    set: vi.fn<CacheStore['set']>().mockResolvedValue(undefined),
    revalidate: vi.fn<CacheStore['revalidate']>().mockResolvedValue(undefined),
  }
}

describe('cache', () => {
  it('runs the handler and stores the output on miss', async () => {
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
    expect(store.get).toHaveBeenCalledWith('k')
    expect(store.set).toHaveBeenCalledWith('k', 'fresh', { tags: ['t1', 't2'], ttl: 60, swr: 30 })
  })

  describe('key derivation', () => {
    it('derives the key from the procedure path and input by default', async () => {
      const store = createStore()
      const procedure = os.$context<CacheContext>().input(type<any>()).use(cache()).handler(() => 'ok')

      await call(procedure, { id: 1 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(procedure, { id: 1 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(procedure, { id: 2 }, { context: { 'cache/store': store }, path: ['planet', 'find'] })
      await call(procedure, { id: 1 }, { context: { 'cache/store': store }, path: ['user', 'find'] })

      const keys = store.get.mock.calls.map(([key]) => key)
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

      const keys = store.get.mock.calls.map(([key]) => key)
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
      const keys = store.get.mock.calls.map(([key]) => key)
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
    expect(store.set).not.toHaveBeenCalled()
  })

  it('key, tags, ttl, swr, enabled can be async functions', async () => {
    const store = createStore()
    const keyFn = vi.fn().mockResolvedValueOnce('k')
    const tagsFn = vi.fn().mockResolvedValueOnce(['t'])
    const ttlFn = vi.fn().mockResolvedValueOnce(60)
    const swrFn = vi.fn().mockResolvedValueOnce(30)
    const enabledFn = vi.fn().mockResolvedValueOnce(true)
    const mw = cache({ key: keyFn, tags: tagsFn, ttl: ttlFn, swr: swrFn, enabled: enabledFn })
    const procedure = os
      .$context<CacheContext & { __context__: boolean }>()
      .input(type<any>())
      .use(mw)
      .handler(() => 'ok')

    await expect(
      call(procedure, '__input__', { context: { 'cache/store': store, '__context__': true }, path: ['__path__'] }),
    ).resolves.toBe('ok')

    expect(store.set).toHaveBeenCalledWith('k', 'ok', { tags: ['t'], ttl: 60, swr: 30 })

    for (const fn of [keyFn, tagsFn, ttlFn, swrFn, enabledFn]) {
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ procedure, path: ['__path__'], context: expect.objectContaining({ __context__: true }) }),
        '__input__',
      )
    }
  })

  it('skips lookup and store when enabled resolves to false', async () => {
    const store = createStore()
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k', enabled: () => false })).handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).resolves.toBe('fresh')

    expect(store.get).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
  })

  it('records misses into the handler plugin context with option tags', async () => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k', tags: ['t'] }))
      .handler(() => 'ok')

    await call(procedure, undefined, {
      context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
      path: ['__path__'],
    })

    expect(pluginContext.caches).toEqual([
      { procedure, path: ['__path__'], tags: ['t'] },
    ])
  })

  it('records hits into the handler plugin context with the stored entry tags', async () => {
    const store = createStore({ output: 'cached', tags: ['stored'], expiresAt: nowInSeconds() + 60 })
    const pluginContext: Exclude<CacheHandlerPluginContext[typeof CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined> = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k', tags: ['optioned'] }))
      .handler(() => 'ok')

    await call(procedure, undefined, {
      context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
      path: ['__path__'],
    })

    expect(pluginContext.caches).toEqual([
      expect.objectContaining({ procedure, path: ['__path__'], tags: ['stored'] }),
    ])
    expect(pluginContext.caches[0]!.ttl).toBeGreaterThan(0) // the entry's remaining freshness
  })

  it.each(['get', 'set'] as const)('propagates store.%s failures and records no check', async (method) => {
    const store = createStore()
    store[method].mockRejectedValueOnce(new Error('store down'))
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k' }))
      .handler(() => 'ok')

    await expect(
      call(procedure, undefined, {
        context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
      }),
    ).rejects.toThrow('store down')

    expect(pluginContext.caches).toEqual([])
  })

  describe('stale-while-revalidate', () => {
    it('serves stale output and refreshes in the background via waitUntil', async () => {
      const store = createStore({ output: 'stale', tags: ['t'], expiresAt: nowInSeconds() - 1 })
      const handlerFn = vi.fn().mockReturnValue('fresh')
      const waitUntil = vi.fn()
      const pluginContext = { caches: [], revalidations: [] }
      const procedure = os
        .$context<CacheContext & CacheHandlerPluginContext>()
        .use(cache({ key: 'k', tags: ['t'], ttl: 60, swr: 30 }))
        .handler(handlerFn)

      await expect(
        call(procedure, undefined, {
          context: { 'cache/store': store, 'cache/waitUntil': waitUntil, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
          path: ['__path__'],
        }),
      ).resolves.toBe('stale')

      expect(pluginContext.caches).toEqual([
        { procedure, path: ['__path__'], tags: ['t'], ttl: 0, swr: 30 },
      ])

      expect(waitUntil).toHaveBeenCalledTimes(1)
      await waitUntil.mock.calls[0]![0]

      expect(handlerFn).toHaveBeenCalledTimes(1)
      expect(store.set).toHaveBeenCalledWith('k', 'fresh', { tags: ['t'], ttl: 60, swr: 30 })
    })

    it('refreshes in the background without waitUntil', async () => {
      const store = createStore({ output: 'stale', tags: [], expiresAt: nowInSeconds() - 1 })
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => 'fresh')

      await expect(
        call(procedure, undefined, { context: { 'cache/store': store } }),
      ).resolves.toBe('stale')

      await vi.waitFor(() => expect(store.set).toHaveBeenCalledWith('k', 'fresh', { tags: undefined, ttl: undefined, swr: undefined }))
    })

    it('hands background refresh failures to waitUntil', async () => {
      const store = createStore({ output: 'stale', tags: [], expiresAt: nowInSeconds() - 1 })
      const waitUntil = vi.fn()
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => {
        throw new Error('handler down')
      })

      await expect(
        call(procedure, undefined, { context: { 'cache/store': store, 'cache/waitUntil': waitUntil } }),
      ).resolves.toBe('stale')

      // The raw refresh is handed over, so the runtime can report the failure.
      await expect(waitUntil.mock.calls[0]![0]).rejects.toThrow('handler down')
      expect(store.set).not.toHaveBeenCalled()
    })

    it('leaves refresh failures unhandled without waitUntil', async ({ onTestFinished }) => {
      const unhandledRejectionHandler = vi.fn()
      process.on('unhandledRejection', unhandledRejectionHandler)

      onTestFinished(() => {
        process.off('unhandledRejection', unhandledRejectionHandler)
      })

      const store = createStore({ output: 'stale', tags: [], expiresAt: nowInSeconds() - 1 })
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => {
        throw new Error('handler down')
      })

      await expect(
        call(procedure, undefined, { context: { 'cache/store': store } }),
      ).resolves.toBe('stale')

      await vi.waitFor(() => expect(unhandledRejectionHandler).toHaveBeenCalledWith(new Error('handler down'), expect.any(Promise)))
      expect(store.set).not.toHaveBeenCalled()
    })
  })

  describe('concurrency', () => {
    it('runs the handler once per concurrent miss, then serves the stored output', async () => {
      const store = new MemoryCacheStore()
      const handlerFn = vi.fn(() => 'fresh')
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(handlerFn)
      const run = () => call(procedure, undefined, { context: { 'cache/store': store } })

      await expect(Promise.all([run(), run()])).resolves.toEqual(['fresh', 'fresh'])
      expect(handlerFn).toHaveBeenCalledTimes(2) // misses are not coalesced

      await expect(run()).resolves.toBe('fresh')
      expect(handlerFn).toHaveBeenCalledTimes(2)
    })

    it('serves every concurrent stale hit immediately, refreshing once per hit', async () => {
      const store = new MemoryCacheStore()
      await store.set('k', 'stale', { ttl: 0, swr: 60 })

      const handlerFn = vi.fn(() => 'fresh')
      const waitUntil = vi.fn()
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k', ttl: 60 })).handler(handlerFn)
      const run = () => call(procedure, undefined, { context: { 'cache/store': store, 'cache/waitUntil': waitUntil } })

      await expect(Promise.all([run(), run()])).resolves.toEqual(['stale', 'stale'])
      expect(handlerFn).toHaveBeenCalledTimes(2) // refreshes are not coalesced either

      await Promise.all(waitUntil.mock.calls.map(([refresh]) => refresh))

      await expect(run()).resolves.toBe('fresh')
      expect(handlerFn).toHaveBeenCalledTimes(2)
    })
  })
})

describe('revalidate', () => {
  it('revalidates tags after the handler succeeds', async () => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(revalidate({ tags: ['planets'] }))
      .handler(() => 'ok')

    await expect(
      call(procedure, undefined, {
        context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
        path: ['__path__'],
      }),
    ).resolves.toBe('ok')

    expect(store.revalidate).toHaveBeenCalledWith({ tags: ['planets'] })
    expect(pluginContext.revalidations).toEqual([
      { procedure, path: ['__path__'], tags: ['planets'] },
    ])
  })

  it('tags can be an async function', async () => {
    const store = createStore()
    const tagsFn = vi.fn().mockResolvedValueOnce(['t'])
    const procedure = os
      .$context<CacheContext & { __context__: boolean }>()
      .input(type<any>())
      .use(revalidate({ tags: tagsFn }))
      .handler(() => 'ok')

    await call(procedure, '__input__', { context: { 'cache/store': store, '__context__': true }, path: ['__path__'] })

    expect(store.revalidate).toHaveBeenCalledWith({ tags: ['t'] })
    expect(tagsFn).toHaveBeenCalledTimes(1)
    expect(tagsFn).toHaveBeenCalledWith(
      expect.objectContaining({ procedure, path: ['__path__'], context: expect.objectContaining({ __context__: true }) }),
      '__input__',
    )
  })

  it('skips the revalidation when the handler throws', async () => {
    const store = createStore()
    const procedure = os.$context<CacheContext>().use(revalidate({ tags: ['planets'] })).handler(() => {
      throw new Error('handler down')
    })

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).rejects.toThrow('handler down')

    expect(store.revalidate).not.toHaveBeenCalled()
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('skips the revalidation and recording when tags resolve to %s', async (_, tags) => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(revalidate({ tags: () => tags }))
      .handler(() => 'ok')

    await call(procedure, undefined, {
      context: { 'cache/store': store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
    })

    expect(store.revalidate).not.toHaveBeenCalled()
    expect(pluginContext.revalidations).toEqual([])
  })
})

describe('cache + revalidate combined', () => {
  it('revalidates before storing on miss, and skips the revalidation on hit', async () => {
    const store = createStore()
    const procedure = os
      .$context<CacheContext>()
      .use(cache({ key: 'k', tags: ['t'] }))
      .use(revalidate({ tags: ['t'] }))
      .handler(() => 'ok')

    await call(procedure, undefined, { context: { 'cache/store': store } })

    expect(store.revalidate).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.revalidate.mock.invocationCallOrder[0]!).toBeLessThan(store.set.mock.invocationCallOrder[0]!)

    store.get.mockResolvedValueOnce({ output: 'cached', tags: ['t'] })

    await expect(
      call(procedure, undefined, { context: { 'cache/store': store } }),
    ).resolves.toBe('cached')

    expect(store.revalidate).toHaveBeenCalledTimes(1)
  })
})
