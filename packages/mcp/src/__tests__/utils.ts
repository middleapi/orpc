import type { McpRegistrar, McpRegistrarRegisterOptions } from '../registrar'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, InMemoryTransport, McpServer } from '@modelcontextprotocol/server'

export type ProtocolEra = 'legacy' | 'modern'

export const PROTOCOL_ERAS: ProtocolEra[] = ['legacy', 'modern']

export function createTestServer(): McpServer {
  return new McpServer({ name: 'test-server', version: '1.0.0' })
}

/**
 * Connects a real MCP client to servers the registrar registers its tools on:
 * - `legacy` serves a single server over an in-memory transport (2025-era protocol),
 * - `modern` serves a fresh server per request through `createMcpHandler` (2026-07-28 protocol).
 */
export async function createTestClient(
  era: ProtocolEra,
  registrar: McpRegistrar<any>,
  { context, requestInit }: { context?: McpRegistrarRegisterOptions<any>['context'], requestInit?: RequestInit } = {},
): Promise<Client> {
  const createServer = async () => {
    const server = createTestServer()
    await registrar.register(server, { context })
    return server
  }

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  )

  onTestFinished(() => client.close())

  if (era === 'legacy') {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await (await createServer()).connect(serverTransport)
    await client.connect(clientTransport)
  }
  else {
    const handler = createMcpHandler(createServer, { legacy: 'reject' })
    onTestFinished(() => handler.close())

    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
      requestInit,
    }))
  }

  return client
}
