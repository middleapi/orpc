it('exports createPiniaColadaUtils, PINIA_COLADA_OPERATION_CONTEXT_SYMBOL', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createPiniaColadaUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    buildKey: expect.any(Function),
    CompositeRouterUtilsPlugin: expect.any(Function),
    PINIA_COLADA_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})
