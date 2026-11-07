it('exports ZodToJsonSchemaConverter', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    ZodToJsonSchemaConverter: expect.any(Function),
  })
})
