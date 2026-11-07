it('exports somethings', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    disposableAllAbortSignal: expect.any(Function),
  })
})
