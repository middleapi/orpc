it('exports encodeHibernationRPCEvent, HibernationHandlerPlugin', async () => {
  await expect(import('./index.ts')).resolves.toMatchObject({
    encodeHibernationRPCEvent: expect.any(Function),
    HibernationHandlerPlugin: expect.any(Function),
  })
})
