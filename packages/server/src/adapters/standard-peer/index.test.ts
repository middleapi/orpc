it('exports createStandardPeerRequestHandler', async () => {
  await expect(import('.')).resolves.toHaveProperty('createStandardPeerRequestHandler')
})

it('exports PeerRegistry', async () => {
  await expect(import('.')).resolves.toHaveProperty('PeerRegistry')
})
