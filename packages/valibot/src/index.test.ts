it('exports ValibotToJsonSchemaConverter', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    ValibotToJsonSchemaConverter: expect.any(Function),
  })
})
