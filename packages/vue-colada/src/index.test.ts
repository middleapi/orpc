it('exports createORPCVueColadaUtils, VUE_COLADA_OPERATION_CONTEXT_SYMBOL', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createORPCVueColadaUtils: expect.any(Function),
    createRouterUtils: expect.any(Function),
    buildKey: expect.any(Function),
    CompositeRouterUtilsPlugin: expect.any(Function),
    VUE_COLADA_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})
