it('exports somethings', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    disposableAllAbortSignal: expect.any(Function),
  })
})
