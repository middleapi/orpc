it('exports createStandardPeerRequestHandler', async () => {
  await expect(import('.')).resolves.toHaveProperty('createStandardPeerRequestHandler')
})

it('exports ServerPeerRegistry', async () => {
  await expect(import('.')).resolves.toHaveProperty('ServerPeerRegistry')
})
