it('exports createPiniaColadaUtils, PINIA_COLADA_OPERATION_CONTEXT_SYMBOL, StreamQuerySSRUtilsPlugin', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createPiniaColadaUtils: expect.any(Function),
    PINIA_COLADA_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
    StreamQuerySSRUtilsPlugin: expect.any(Function),
  })
})

it('exports createRouterUtils, but no generic context symbol or utils classes', async () => {
  const exports = await import('./index')

  expect(exports).toHaveProperty('createRouterUtils')
  expect(exports).not.toHaveProperty('OPERATION_CONTEXT_SYMBOL')
  expect(exports).not.toHaveProperty('ProcedureUtils')
  expect(exports).not.toHaveProperty('SharedUtils')
})
