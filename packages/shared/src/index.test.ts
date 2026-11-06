it('exports somethings', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    allAbortSignal: expect.any(Function),
    limitArraySize: expect.any(Function),
    pipeStreamToCache: expect.any(Function),
    runWithOwnSignal: expect.any(Function),
    streamedArrayKeyOptions: expect.any(Function),
    streamedArrayWrites: expect.any(Function),
  })
})
