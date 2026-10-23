it('exports os, ORPCError, createRouterClient, RPCJsonSerializer, RPCSerializer', async () => {
  await expect(import('.')).resolves.toMatchObject({
    os: expect.any(Object),
    ORPCError: expect.any(Function),
    createRouterClient: expect.any(Function),
    RPCJsonSerializer: expect.any(Function),
    RPCSerializer: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('.')

  expect(mod).not.toHaveProperty('augmentImplementedRouter')
  expect(mod).not.toHaveProperty('augmentRouter')
  expect(mod).not.toHaveProperty('cloneORPCError')
  expect(mod).not.toHaveProperty('createContractProcedure')
  expect(mod).not.toHaveProperty('createGuardedProcedureLazy')
  expect(mod).not.toHaveProperty('createRouterImplementer')
  expect(mod).not.toHaveProperty('decorateMiddleware')
  expect(mod).not.toHaveProperty('getHiddenRouterContract')
  expect(mod).not.toHaveProperty('reconcileORPCError')
  expect(mod).not.toHaveProperty('SharedRouterImplementer')
  expect(mod).not.toHaveProperty('withHiddenRouterContract')
})
