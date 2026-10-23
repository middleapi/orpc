it('exports', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    handlerGen: expect.any(Function),
    middlewareGen: expect.any(Function),
    EffectSchemaToJsonSchemaConverter: expect.any(Function),
    catchORPCError: expect.any(Function),
    catchORPCErrorCode: expect.any(Function),
    catchORPCErrorCodes: expect.any(Function),
    createEffectClient: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('./index')

  expect(mod).not.toHaveProperty('runPromise')
  expect(mod).not.toHaveProperty('toStandardSchema')
})
