it('exports the plugins, middleware factories, tiered store, and key helper', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    CacheHandlerPlugin: expect.any(Function),
    CacheLinkPlugin: expect.any(Function),
    cacheRouterClientInterceptor: expect.any(Function),
    TieredCacheStore: expect.any(Function),
    cache: expect.any(Function),
    revalidate: expect.any(Function),
    encodeCacheKey: expect.any(Function),
  })
})
