it('exports plugin, middleware factories, and header helpers', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    CacheHandlerPlugin: expect.any(Function),
    cache: expect.any(Function),
    revalidate: expect.any(Function),
    encodeCacheTagHeader: expect.any(Function),
    decodeCacheTagHeader: expect.any(Function),
    CACHE_TAG_HEADER: 'orpc-cache-tag',
    CACHE_TAG_INVALIDATION_HEADER: 'orpc-cache-tag-invalidation',
  })
})
