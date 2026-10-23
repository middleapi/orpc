it.each([
  ['.', ['OpenRPCGenerator', 'COMMON_JSON_RPC_ERROR_CODE_MAP']],
  ['./adapters/standard', ['OpenRPCHandlerCodec', 'OpenRPCEnvelopeHandlerPlugin', 'OpenRPCLinkCodec', 'getJsonRpcCall']],
  ['./adapters/fetch', ['OpenRPCHandler', 'OpenRPCLink']],
  ['./adapters/node', ['OpenRPCHandler']],
  ['./adapters/fastify', ['OpenRPCHandler']],
  ['./adapters/aws-lambda', ['OpenRPCHandler']],
  ['./plugins', ['OpenRPCDiscoveryHandlerPlugin']],
])('%s exports %j', async (path, names) => {
  expect(Object.keys(await import(path))).toEqual(expect.arrayContaining(names))
})
