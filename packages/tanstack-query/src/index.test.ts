it('exports createTanstackQueryUtils, TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL, experimental_CacheRevalidationUtilsPlugin', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createTanstackQueryUtils: expect.any(Function),
    TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    experimental_CacheRevalidationUtilsPlugin: expect.any(Function),
  })
})
