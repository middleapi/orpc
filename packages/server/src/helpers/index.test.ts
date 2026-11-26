it('exports helpers', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    encodeBase64url: expect.any(Function),
    setCookie: expect.any(Function),
    encrypt: expect.any(Function),
    sign: expect.any(Function),
  })
})
