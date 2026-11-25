import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'

import type { McpRegistrar, McpRegistrarRegisterOptions } from '../registrar'

type TestHandler = ReturnType<typeof createMcpHandler>
type TestHandlerFetchOptions = Parameters<TestHandler['fetch']>[1]

export function createTestServer(): McpServer {
  return new McpServer({ name: 'test-server', version: '1.0.0' })
}

export function createTestHandler(
  createServer: Parameters<typeof createMcpHandler>[0],
): TestHandler {
  const handler = createMcpHandler(createServer, { legacy: 'reject' })
  onTestFinished(() => handler.close())

  return handler
}

export async function connectTestClient(
  handler: TestHandler,
  { requestInit, ...fetchOptions }: TestHandlerFetchOptions & { requestInit?: RequestInit } = {},
): Promise<Client> {
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  onTestFinished(() => client.close())

  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init), fetchOptions),
      requestInit,
    }),
  )

  return client
}

export function createTestClient(
  registrar: McpRegistrar<any>,
  {
    context,
    requestInit,
  }: { context?: McpRegistrarRegisterOptions<any>['context']; requestInit?: RequestInit } = {},
): Promise<Client> {
  const handler = createTestHandler(async () => {
    const server = createTestServer()
    await registrar.register(server, { context })
    return server
  })

  return connectTestClient(handler, { requestInit })
}
