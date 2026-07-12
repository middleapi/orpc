it('exports PinoHandlerPlugin, getLogger', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    PinoHandlerPlugin: expect.any(Function),
    getLogger: expect.any(Function),
  })
})
