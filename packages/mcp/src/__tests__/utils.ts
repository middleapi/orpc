import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'

import type { McpRegistrar, McpRegistrarRegisterOptions } from '../registrar'

export function createTestServer(): McpServer {
  return new McpServer({ name: 'test-server', version: '1.0.0' })
}

/**
 * Connects a real MCP client over the 2026-07-28 protocol, with a fresh server
 * the registrar registers its tools on for every request.
 */
export async function createTestClient(
  registrar: McpRegistrar<any>,
  {
    context,
    requestInit,
  }: { context?: McpRegistrarRegisterOptions<any>['context']; requestInit?: RequestInit } = {},
): Promise<Client> {
  const handler = createMcpHandler(
    async () => {
      const server = createTestServer()
      await registrar.register(server, { context })
      return server
    },
    { legacy: 'reject' },
  )
  onTestFinished(() => handler.close())

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  onTestFinished(() => client.close())

  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
      requestInit,
    }),
  )

  return client
}
