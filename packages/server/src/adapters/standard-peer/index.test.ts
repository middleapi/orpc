it('exports createStandardPeerRequestHandler', async () => {
  await expect(import('./index.ts')).resolves.toHaveProperty('createStandardPeerRequestHandler')
})
