it('exports createTanstackQueryUtils, TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    createTanstackQueryUtils: expect.any(Function),
    TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL: expect.any(Symbol),
  })
})

it('exports createRouterUtils, but no generic context symbol or utils classes', async () => {
  const exports = await import('./index')

  expect(exports).toHaveProperty('createRouterUtils')
  expect(exports).not.toHaveProperty('OPERATION_CONTEXT_SYMBOL')
  expect(exports).not.toHaveProperty('ProcedureUtils')
  expect(exports).not.toHaveProperty('SharedUtils')
})
