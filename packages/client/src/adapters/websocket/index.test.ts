it('exports RPCLink', async () => {
  await expect(import('.')).resolves.toHaveProperty('RPCLink')
})

it('exports keep-alive helpers', async () => {
  const module = await import('.')

  expect(module).toHaveProperty('WEBSOCKET_KEEP_ALIVE_PING')
  expect(module).toHaveProperty('WEBSOCKET_KEEP_ALIVE_PONG')
  expect(module).toHaveProperty('isWebSocketKeepAliveMessage')
})
