it('exports OpenRPCHandler and OpenRPCLink', async () => {
  expect(Object.keys(await import('.')).sort()).toEqual(['OpenRPCHandler', 'OpenRPCLink'])
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCHandler: expect.any(Function),
    OpenRPCLink: expect.any(Function),
  })
})
