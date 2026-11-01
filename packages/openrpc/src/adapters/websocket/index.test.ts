it('exports OpenRPCHandler, OpenRPCLink and OpenRPCWebSocketLinkTransport', async () => {
  await expect(import('.')).resolves.toMatchObject({
    OpenRPCHandler: expect.any(Function),
    OpenRPCLink: expect.any(Function),
    OpenRPCWebSocketLinkTransport: expect.any(Function),
  })
})
