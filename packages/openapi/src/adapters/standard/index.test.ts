it('exports OpenAPIMatcher, OpenAPIHandlerCodec, OpenAPILinkCodec', async () => {
  await expect(import('.')).resolves.toMatchObject({
    OpenAPIMatcher: expect.any(Function),
    OpenAPIHandlerCodec: expect.any(Function),
    OpenAPILinkCodec: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('.')

  expect(mod).not.toHaveProperty('serializeHeaders')
})
