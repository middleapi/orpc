it('exports createPiniaColadaUtils, PINIA_COLADA_OPERATION_CONTEXT_SYMBOL, StreamQuerySSRUtilsPlugin', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    createPiniaColadaUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    PINIA_COLADA_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    StreamQuerySSRUtilsPlugin: expect.any(Function),
  })
})
