it('exports StandardLink, RPCLinkCodec', async () => {
  await expect(import('.')).resolves.toMatchObject({
    StandardLink: expect.any(Function),
    RPCLinkCodec: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('.')

  expect(mod).not.toHaveProperty('CompositeStandardLinkPlugin')
})
