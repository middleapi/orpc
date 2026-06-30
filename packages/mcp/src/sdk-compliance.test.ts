import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import * as z from 'zod'
import { MCPHandler } from './adapters/node/mcp-handler'
import { mcp } from './meta'

// A router exercising all three primitives + a typed error, served to the
// OFFICIAL @modelcontextprotocol/sdk client over real HTTP. If the canonical
// client can complete the handshake and drive every primitive, the server is
// genuinely protocol-compliant — not just self-consistent.

const greet = os
  .meta(mcp.tool({ title: 'Greet', description: 'Greet a person' }))
  .input(z.object({ name: z.string() }))
  .output(z.object({ message: z.string() }))
  .handler(({ input }) => ({ message: `Hello, ${input.name}!` }))

const failing = os
  .meta(mcp.tool({ description: 'always fails' }))
  .input(z.object({}))
  .errors({ FORBIDDEN: { message: 'nope' } })
  .handler(({ errors }) => {
    throw errors.FORBIDDEN()
  })

// Regression: a tool that DECLARES an output schema and then errors. The SDK
// validates `structuredContent` against the outputSchema, so the in-band error
// result must omit it — otherwise the client rejects with -32602.
const failingTyped = os
  .meta(mcp.tool({ description: 'errors but declares an output schema' }))
  .input(z.object({}))
  .output(z.object({ ok: z.boolean() }))
  .errors({ CONFLICT: { message: 'boom' } })
  .handler(({ errors }) => {
    throw errors.CONFLICT()
  })

const config = os
  .meta(mcp.resource({ uri: 'config://app', mimeType: 'text/plain' }))
  .output(z.string())
  .handler(() => 'debug=true')

const planet = os
  .meta(mcp.resource({ uriTemplate: 'planet://{id}', mimeType: 'application/json' }))
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handler(({ input }) => ({ id: input.id, name: `Planet ${input.id}` }))

const planTrip = os
  .meta(mcp.prompt({ description: 'Plan a vacation' }))
  .input(z.object({ destination: z.string() }))
  .output(z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.object({ type: z.literal('text'), text: z.string() }),
    })),
  }))
  .handler(({ input }) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Plan a trip to ${input.destination}` } }],
  }))

const router = { greet, failing, failingTyped, config, planet, planTrip }

describe('official MCP SDK client <-> @orpc/mcp node handler (e2e over HTTP)', () => {
  let server: Server
  let client: Client

  beforeAll(async () => {
    const handler = new MCPHandler(router, {
      serverInfo: { name: 'orpc-mcp-e2e', version: '1.0.0' },
      converters: [new ZodToJsonSchemaConverter()],
    })

    server = createServer((req, res) => {
      void handler.handle(req, res, { context: {} })
    })
    await new Promise<void>(resolve => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo

    client = new Client({ name: 'e2e-test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
  })

  afterAll(async () => {
    await client?.close()
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve()
        return
      }
      server.close(() => resolve())
    })
  })

  it('completes the initialize handshake and exposes capabilities', () => {
    const capabilities = client.getServerCapabilities()
    expect(capabilities?.tools).toBeDefined()
    expect(capabilities?.resources).toBeDefined()
    expect(capabilities?.prompts).toBeDefined()
    expect(client.getServerVersion()).toMatchObject({ name: 'orpc-mcp-e2e', version: '1.0.0' })
  })

  it('lists tools with JSON Schema input', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toContain('greet')
    const greetTool = tools.find(t => t.name === 'greet')!
    expect(greetTool.description).toBe('Greet a person')
    expect(greetTool.inputSchema.type).toBe('object')
    expect(greetTool.inputSchema.properties).toHaveProperty('name')
  })

  it('calls a tool and receives content + structuredContent', async () => {
    const result = await client.callTool({ name: 'greet', arguments: { name: 'World' } })
    expect(result.isError).toBeFalsy()
    expect((result.content as Array<{ type: string, text: string }>)[0]!.text).toContain('Hello, World!')
    expect(result.structuredContent).toEqual({ message: 'Hello, World!' })
  })

  it('surfaces a thrown typed error as an in-band tool error', async () => {
    const result = await client.callTool({ name: 'failing', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ type: string, text: string }>)[0]!.text).toBe('nope')
  })

  it('errors a schema-typed tool without violating its outputSchema (regression)', async () => {
    const result = await client.callTool({ name: 'failingTyped', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ type: string, text: string }>)[0]!.text).toBe('boom')
  })

  it('lists and reads a static resource', async () => {
    const { resources } = await client.listResources()
    expect(resources.map(r => r.uri)).toContain('config://app')

    const read = await client.readResource({ uri: 'config://app' })
    expect((read.contents[0] as { text: string }).text).toBe('debug=true')
  })

  it('lists and reads a templated resource', async () => {
    const { resourceTemplates } = await client.listResourceTemplates()
    expect(resourceTemplates.map(r => r.uriTemplate)).toContain('planet://{id}')

    const read = await client.readResource({ uri: 'planet://mars' })
    expect(JSON.parse((read.contents[0] as { text: string }).text)).toEqual({ id: 'mars', name: 'Planet mars' })
  })

  it('lists and gets a prompt', async () => {
    const { prompts } = await client.listPrompts()
    expect(prompts.map(p => p.name)).toContain('planTrip')

    const got = await client.getPrompt({ name: 'planTrip', arguments: { destination: 'Tokyo' } })
    expect((got.messages[0]!.content as { type: string, text: string }).text).toContain('Tokyo')
  })
})
