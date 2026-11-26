it('exports ZodToJsonSchemaConverter', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    ZodToJsonSchemaConverter: expect.any(Function),
  })
})
