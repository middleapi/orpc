it('exports plugins', async () => {
  await expect(import('.')).resolves.toMatchObject({
    BatchHandlerPlugin: expect.any(Function),
    CORSHandlerPlugin: expect.any(Function),
    RequestHeadersHandlerPlugin: expect.any(Function),
    ResponseHeadersHandlerPlugin: expect.any(Function),
    CSRFGuardHandlerPlugin: expect.any(Function),
  })
})
