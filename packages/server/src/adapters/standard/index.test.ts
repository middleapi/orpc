it('exports StandardHandler, resolveFriendlyStandardHandlerHandleOptions, RPCMatcher, RPCHandlerCodec', async () => {
  await expect(import('.')).resolves.toMatchObject({
    StandardHandler: expect.any(Function),
    resolveFriendlyStandardHandlerHandleOptions: expect.any(Function),
    RPCMatcher: expect.any(Function),
    RPCHandlerCodec: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('.')

  expect(mod).not.toHaveProperty('CompositeStandardHandlerPlugin')
  expect(mod).not.toHaveProperty('TracingHandlerPlugin')
})
