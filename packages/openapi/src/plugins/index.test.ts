it('exports OpenAPIReferenceHandlerPlugin', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    OpenAPIReferenceHandlerPlugin: expect.any(Function),
  })
})
