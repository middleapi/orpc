it('exports OpenRPCHandler', async () => {
  expect(Object.keys(await import('.'))).toEqual(['OpenRPCHandler'])
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCHandler: expect.any(Function),
  })
})
