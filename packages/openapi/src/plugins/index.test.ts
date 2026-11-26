it('exports OpenAPIReferenceHandlerPlugin', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    OpenAPIReferenceHandlerPlugin: expect.any(Function),
  })
})
