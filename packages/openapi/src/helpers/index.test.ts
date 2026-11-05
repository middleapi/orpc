it('exports helpers', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    parseFormData: expect.any(Function),
  })
})
