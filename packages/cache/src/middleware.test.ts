import type { CacheHandlerPluginContext } from './handler-plugin'
import type { CacheContext, CacheEntry, CacheStore } from './types'
import { call, os, type } from '@orpc/server'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'
import { cache, revalidate } from './middleware'

function createStore(entry?: CacheEntry) {
  return {
    get: vi.fn<CacheStore['get']>().mockResolvedValue(entry),
    set: vi.fn<CacheStore['set']>().mockResolvedValue(undefined),
    revalidateTag: vi.fn<CacheStore['revalidateTag']>().mockResolvedValue(undefined),
  }
}

describe('cache', () => {
  it('runs the handler and stores the output on miss', async () => {
    const store = createStore()
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os
      .$context<CacheContext>()
      .use(cache({ key: 'k', tags: ['t1', 't2'], ttl: 1000, swr: 500 }))
      .handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).resolves.toBe('fresh')

    expect(handlerFn).toHaveBeenCalledTimes(1)
    expect(store.get).toHaveBeenCalledWith('k')
    expect(store.set).toHaveBeenCalledWith('k', 'fresh', { tags: ['t1', 't2'], ttl: 1000, swr: 500 })
  })

  describe('key derivation', () => {
    it('derives the key from the procedure path and input by default', async () => {
      const store = createStore()
      const procedure = os.$context<CacheContext>().input(type<any>()).use(cache()).handler(() => 'ok')

      await call(procedure, { id: 1 }, { context: { cache: store }, path: ['planet', 'find'] })
      await call(procedure, { id: 1 }, { context: { cache: store }, path: ['planet', 'find'] })
      await call(procedure, { id: 2 }, { context: { cache: store }, path: ['planet', 'find'] })
      await call(procedure, { id: 1 }, { context: { cache: store }, path: ['user', 'find'] })

      const keys = store.get.mock.calls.map(([key]) => key)
      expect(keys[0]).toEqual([['planet', 'find'], { id: 1 }]) // the procedure path and input
      expect(keys[0]).toEqual(keys[1]) // same path + input
      expect(keys[0]).not.toEqual(keys[2]) // different input
      expect(keys[0]).not.toEqual(keys[3]) // different path
    })

    it('derives the key from non-string key material, and uses string keys verbatim', async () => {
      const store = createStore()
      const material = os
        .$context<CacheContext>()
        .input(type<any>())
        .use(cache({ key: (_, input) => ({ id: input.id }) }))
        .handler(() => 'ok')
      const verbatim = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => 'ok')

      await call(material, { id: 1, page: 1 }, { context: { cache: store }, path: ['planet', 'find'] })
      await call(material, { id: 1, page: 2 }, { context: { cache: store }, path: ['planet', 'find'] })
      await call(verbatim, undefined, { context: { cache: store } })

      const keys = store.get.mock.calls.map(([key]) => key)
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

      await call(procedure, { id: 1, page: 1 } as any, { context: { cache: store } })
      await call(procedure, { id: 1, page: 2 } as any, { context: { cache: store } })

      // The middleware only validated `id` at its position, but the key still
      // covers the full input, so different pages never share an entry.
      const keys = store.get.mock.calls.map(([key]) => key)
      expect(keys[0]).not.toEqual(keys[1])
    })
  })

  it('short-circuits the handler on fresh hit', async () => {
    const store = createStore({ output: 'cached', tags: ['t'], expiresAt: Date.now() + 1000 })
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).resolves.toBe('cached')

    expect(handlerFn).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
  })

  it('treats entries without expiresAt as always fresh', async () => {
    const store = createStore({ output: 'cached', tags: [] })
    const handlerFn = vi.fn()
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).resolves.toBe('cached')

    expect(handlerFn).not.toHaveBeenCalled()
  })

  it('serves cached undefined outputs', async () => {
    const store = createStore({ output: undefined, tags: [] })
    const handlerFn = vi.fn().mockReturnValue('fresh')
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(handlerFn)

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).resolves.toBeUndefined()

    expect(handlerFn).not.toHaveBeenCalled()
  })

  it('key, tags, ttl, swr, enabled can be async functions', async () => {
    const store = createStore()
    const keyFn = vi.fn().mockResolvedValueOnce('k')
    const tagsFn = vi.fn().mockResolvedValueOnce(['t'])
    const ttlFn = vi.fn().mockResolvedValueOnce(1000)
    const swrFn = vi.fn().mockResolvedValueOnce(500)
    const enabledFn = vi.fn().mockResolvedValueOnce(true)
    const mw = cache({ key: keyFn, tags: tagsFn, ttl: ttlFn, swr: swrFn, enabled: enabledFn })
    const procedure = os
      .$context<CacheContext & { __context__: boolean }>()
      .input(type<any>())
      .use(mw)
      .handler(() => 'ok')

    await expect(
      call(procedure, '__input__', { context: { cache: store, __context__: true }, path: ['__path__'] }),
    ).resolves.toBe('ok')

    expect(store.set).toHaveBeenCalledWith('k', 'ok', { tags: ['t'], ttl: 1000, swr: 500 })

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
      call(procedure, undefined, { context: { cache: store } }),
    ).resolves.toBe('fresh')

    expect(store.get).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
  })

  it.each<[string, () => any]>([
    ['async iterator', () => (async function* () {})()],
    ['readable stream', () => new ReadableStream()],
  ])('never stores %s outputs and records no check', async (_, handlerFn) => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k', tags: ['t'] }))
      .handler(handlerFn)

    await call(procedure, undefined, {
      context: { cache: store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
    })

    expect(store.set).not.toHaveBeenCalled()
    expect(pluginContext.caches).toEqual([])
  })

  it('records misses into the handler plugin context with option tags', async () => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k', tags: ['t'] }))
      .handler(() => 'ok')

    await call(procedure, undefined, {
      context: { cache: store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
      path: ['__path__'],
    })

    expect(pluginContext.caches).toEqual([
      { procedure, path: ['__path__'], hit: false, stale: false, key: 'k', tags: ['t'] },
    ])
  })

  it('records hits into the handler plugin context with the stored entry tags', async () => {
    const store = createStore({ output: 'cached', tags: ['stored'], expiresAt: Date.now() + 1000 })
    const pluginContext: Exclude<CacheHandlerPluginContext[typeof CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined> = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k', tags: ['optioned'] }))
      .handler(() => 'ok')

    await call(procedure, undefined, {
      context: { cache: store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
      path: ['__path__'],
    })

    expect(pluginContext.caches).toEqual([
      expect.objectContaining({ procedure, path: ['__path__'], hit: true, stale: false, key: 'k', tags: ['stored'] }),
    ])
    expect(pluginContext.caches[0]!.ttl).toBeGreaterThan(0) // the entry's remaining freshness
  })

  it('propagates store.get failures', async () => {
    const store = createStore()
    store.get.mockRejectedValueOnce(new Error('store down'))
    const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => 'ok')

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).rejects.toThrow('store down')
  })

  it('propagates store.set failures and records no check', async () => {
    const store = createStore()
    store.set.mockRejectedValueOnce(new Error('store down'))
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(cache({ key: 'k' }))
      .handler(() => 'ok')

    await expect(
      call(procedure, undefined, {
        context: { cache: store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
      }),
    ).rejects.toThrow('store down')

    expect(pluginContext.caches).toEqual([])
  })

  describe('stale-while-revalidate', () => {
    it('serves stale output and refreshes in the background via waitUntil', async () => {
      const store = createStore({ output: 'stale', tags: ['t'], expiresAt: Date.now() - 1 })
      const handlerFn = vi.fn().mockReturnValue('fresh')
      const waitUntil = vi.fn()
      const pluginContext = { caches: [], revalidations: [] }
      const procedure = os
        .$context<CacheContext & CacheHandlerPluginContext>()
        .use(cache({ key: 'k', tags: ['t'], ttl: 1000, swr: 500 }))
        .handler(handlerFn)

      await expect(
        call(procedure, undefined, {
          context: { cache: store, waitUntil, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
          path: ['__path__'],
        }),
      ).resolves.toBe('stale')

      expect(pluginContext.caches).toEqual([
        { procedure, path: ['__path__'], hit: true, stale: true, key: 'k', tags: ['t'], ttl: 0, swr: 500 },
      ])

      expect(waitUntil).toHaveBeenCalledTimes(1)
      await waitUntil.mock.calls[0]![0]

      expect(handlerFn).toHaveBeenCalledTimes(1)
      expect(store.set).toHaveBeenCalledWith('k', 'fresh', { tags: ['t'], ttl: 1000, swr: 500 })
    })

    it('refreshes in the background without waitUntil', async () => {
      const store = createStore({ output: 'stale', tags: [], expiresAt: Date.now() - 1 })
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => 'fresh')

      await expect(
        call(procedure, undefined, { context: { cache: store } }),
      ).resolves.toBe('stale')

      await vi.waitFor(() => expect(store.set).toHaveBeenCalledWith('k', 'fresh', { tags: [], ttl: undefined, swr: undefined }))
    })

    it('swallows background refresh failures', async () => {
      const store = createStore({ output: 'stale', tags: [], expiresAt: Date.now() - 1 })
      const waitUntil = vi.fn()
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => {
        throw new Error('handler down')
      })

      await expect(
        call(procedure, undefined, { context: { cache: store, waitUntil } }),
      ).resolves.toBe('stale')

      await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined()
      expect(store.set).not.toHaveBeenCalled()
    })

    it('never stores streaming outputs from background refreshes', async () => {
      const store = createStore({ output: 'stale', tags: [], expiresAt: Date.now() - 1 })
      const waitUntil = vi.fn()
      const procedure = os.$context<CacheContext>().use(cache({ key: 'k' })).handler(() => (async function* () {})())

      await expect(
        call(procedure, undefined, { context: { cache: store, waitUntil } }),
      ).resolves.toBe('stale')

      await waitUntil.mock.calls[0]![0]
      expect(store.set).not.toHaveBeenCalled()
    })
  })
})

describe('revalidate', () => {
  it('revalidates tags after the handler succeeds', async () => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(revalidate('planets'))
      .handler(() => 'ok')

    await expect(
      call(procedure, undefined, {
        context: { cache: store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
        path: ['__path__'],
      }),
    ).resolves.toBe('ok')

    expect(store.revalidateTag).toHaveBeenCalledWith(['planets'])
    expect(pluginContext.revalidations).toEqual([
      { procedure, path: ['__path__'], tags: ['planets'] },
    ])
  })

  it('accepts an array of tags', async () => {
    const store = createStore()
    const procedure = os.$context<CacheContext>().use(revalidate(['a', 'b'])).handler(() => 'ok')

    await call(procedure, undefined, { context: { cache: store } })

    expect(store.revalidateTag).toHaveBeenCalledWith(['a', 'b'])
  })

  it('tags can be an async function', async () => {
    const store = createStore()
    const tagsFn = vi.fn().mockResolvedValueOnce(['t'])
    const procedure = os
      .$context<CacheContext & { __context__: boolean }>()
      .input(type<any>())
      .use(revalidate(tagsFn))
      .handler(() => 'ok')

    await call(procedure, '__input__', { context: { cache: store, __context__: true }, path: ['__path__'] })

    expect(tagsFn).toHaveBeenCalledTimes(1)
    expect(tagsFn).toHaveBeenCalledWith(
      expect.objectContaining({ procedure, path: ['__path__'], context: expect.objectContaining({ __context__: true }) }),
      '__input__',
    )
  })

  it('skips the revalidation when the handler throws', async () => {
    const store = createStore()
    const procedure = os.$context<CacheContext>().use(revalidate('planets')).handler(() => {
      throw new Error('handler down')
    })

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).rejects.toThrow('handler down')

    expect(store.revalidateTag).not.toHaveBeenCalled()
  })

  it('skips the revalidation and recording when tags resolve to empty', async () => {
    const store = createStore()
    const pluginContext = { caches: [], revalidations: [] }
    const procedure = os
      .$context<CacheContext & CacheHandlerPluginContext>()
      .use(revalidate(() => [] as unknown as [string, ...string[]]))
      .handler(() => 'ok')

    await call(procedure, undefined, {
      context: { cache: store, [CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]: pluginContext },
    })

    expect(store.revalidateTag).not.toHaveBeenCalled()
    expect(pluginContext.revalidations).toEqual([])
  })
})

describe('cache + revalidate combined', () => {
  it('revalidates before storing on miss, and skips the revalidation on hit', async () => {
    const store = createStore()
    const procedure = os
      .$context<CacheContext>()
      .use(cache({ key: 'k', tags: ['t'] }))
      .use(revalidate('t'))
      .handler(() => 'ok')

    await call(procedure, undefined, { context: { cache: store } })

    expect(store.revalidateTag).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.revalidateTag.mock.invocationCallOrder[0]!).toBeLessThan(store.set.mock.invocationCallOrder[0]!)

    store.get.mockResolvedValueOnce({ output: 'cached', tags: ['t'] })

    await expect(
      call(procedure, undefined, { context: { cache: store } }),
    ).resolves.toBe('cached')

    expect(store.revalidateTag).toHaveBeenCalledTimes(1)
  })
})
