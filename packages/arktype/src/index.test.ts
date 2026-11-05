it('exports ArkTypeToJsonSchemaConverter', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    ArkTypeToJsonSchemaConverter: expect.any(Function),
  })
})
