it('exports createStandardPeerRequestHandler', async () => {
  await expect(import('.')).resolves.toHaveProperty('createStandardPeerRequestHandler')
})

it('exports StandardPeerGuard', async () => {
  await expect(import('.')).resolves.toHaveProperty('StandardPeerGuard')
})
