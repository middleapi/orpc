it('exports OpenAPIHandler', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    OpenAPIHandler: expect.any(Function),
  })
})
