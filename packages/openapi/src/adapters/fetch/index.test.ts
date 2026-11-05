it('exports OpenAPIHandler and OpenAPILink', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    OpenAPIHandler: expect.any(Function),
    OpenAPILink: expect.any(Function),
  })
})
