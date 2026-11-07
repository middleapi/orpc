it('exports oc', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    oc: expect.any(Object),
  })
})
