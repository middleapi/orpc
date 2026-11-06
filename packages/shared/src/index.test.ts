it('exports somethings', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    allAbortSignal: expect.any(Function),
  })
})
