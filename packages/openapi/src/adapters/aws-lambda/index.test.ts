it('exports OpenAPIHandler', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    OpenAPIHandler: expect.any(Function),
  })
})
