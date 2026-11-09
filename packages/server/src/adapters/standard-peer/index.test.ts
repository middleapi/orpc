it('exports createStandardPeerRequestHandler', async () => {
  await expect(import('./index')).resolves.toHaveProperty('createStandardPeerRequestHandler')
})
