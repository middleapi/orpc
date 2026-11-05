it('exports Publisher', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    Publisher: expect.any(Function),
  })
})
