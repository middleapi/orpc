it('exports helpers', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    parseFormData: expect.any(Function),
  })
})
