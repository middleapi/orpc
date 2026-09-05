it('exports the plugin, middleware factories, and key helper', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    CacheHandlerPlugin: expect.any(Function),
    cache: expect.any(Function),
    revalidate: expect.any(Function),
    encodeCacheKey: expect.any(Function),
  })
})
