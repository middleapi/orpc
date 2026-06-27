import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import * as z from 'zod'
import { INVALID_PARAMS, LATEST_PROTOCOL_VERSION, METHOD_NOT_FOUND, RESOURCE_NOT_FOUND } from '../../constants'
import { mcp } from '../../meta'
import { StandardMCPHandler } from './mcp-handler'

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

const planet = os
  .meta(mcp({ type: 'resource', uriTemplate: 'planet://{id}', mimeType: 'application/json' }))
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handler(({ input }) => ({ id: input.id, name: `Planet ${input.id}` }))

const config = os
  .meta(mcp({ type: 'resource', uri: 'config://app', mimeType: 'text/plain' }))
  .output(z.string())
  .handler(() => 'debug=true')

const planTrip = os
  .meta(mcp({ type: 'prompt', description: 'Plan a trip' }))
  .input(z.object({ destination: z.string(), days: z.number() }))
  .output(z.object({
    messages: z.array(z.object({
      role: z.string(),
      content: z.object({ type: z.string(), text: z.string() }),
    })),
  }))
  .handler(({ input }) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Plan ${input.days} days in ${input.destination}` } }],
  }))

// not opted into MCP — must NOT be exposed
const secret = os.input(z.object({})).handler(() => 'secret')

const router = { greet, failing, planet, config, planTrip, secret }

function createHandler() {
  return new StandardMCPHandler(router, { converters: [new ZodToJsonSchemaConverter()], serverInfo: { name: 'test', version: '0.1.0' } })
}

async function send(handler: StandardMCPHandler<any>, method: string, params?: Record<string, unknown>): Promise<any> {
  return handler.handle({ jsonrpc: '2.0', id: 1, method, params }, { context: {} })
}

describe('standardMCPHandler', () => {
  it('initializes and negotiates capabilities from the registry', async () => {
    const res = await send(createHandler(), 'initialize', { protocolVersion: LATEST_PROTOCOL_VERSION })
    expect(res.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(res.result.serverInfo).toEqual({ name: 'test', version: '0.1.0' })
    expect(res.result.capabilities.tools).toBeDefined()
    expect(res.result.capabilities.resources).toBeDefined()
    expect(res.result.capabilities.prompts).toBeDefined()
  })

  it('falls back to the latest protocol version when the client requests an unknown one', async () => {
    const res = await send(createHandler(), 'initialize', { protocolVersion: '1999-01-01' })
    expect(res.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
  })

  it('returns undefined for notifications (no id)', async () => {
    const res = await createHandler().handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { context: {} })
    expect(res).toBeUndefined()
  })

  it('lists only MCP-opted tools, with JSON Schema input/output', async () => {
    const res = await send(createHandler(), 'tools/list')
    const names = res.result.tools.map((t: any) => t.name)
    expect(names).toEqual(expect.arrayContaining(['greet', 'failing']))
    expect(names).not.toContain('secret')

    const greetTool = res.result.tools.find((t: any) => t.name === 'greet')
    expect(greetTool.title).toBe('Greet')
    expect(greetTool.inputSchema.type).toBe('object')
    expect(greetTool.inputSchema.properties).toHaveProperty('name')
    expect(greetTool.outputSchema.type).toBe('object')
  })

  it('calls a tool and returns content + structuredContent', async () => {
    const res = await send(createHandler(), 'tools/call', { name: 'greet', arguments: { name: 'World' } })
    expect(res.result.isError).toBeUndefined()
    expect(res.result.content[0]).toMatchObject({ type: 'text' })
    expect(res.result.content[0].text).toContain('Hello, World!')
    expect(res.result.structuredContent).toEqual({ message: 'Hello, World!' })
  })

  it('reports a thrown ORPCError as an in-band tool error', async () => {
    const res = await send(createHandler(), 'tools/call', { name: 'failing', arguments: {} })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toBe('nope')
    expect(res.result.structuredContent.code).toBe('FORBIDDEN')
  })

  it('rejects an unknown tool with a JSON-RPC error', async () => {
    const res = await send(createHandler(), 'tools/call', { name: 'nope', arguments: {} })
    expect(res.error.code).toBe(INVALID_PARAMS)
  })

  it('rejects an unknown method', async () => {
    const res = await send(createHandler(), 'totally/unknown')
    expect(res.error.code).toBe(METHOD_NOT_FOUND)
  })

  it('lists static resources and resource templates separately', async () => {
    const handler = createHandler()
    const resources = await send(handler, 'resources/list')
    expect(resources.result.resources.map((r: any) => r.uri)).toEqual(['config://app'])

    const templates = await send(handler, 'resources/templates/list')
    expect(templates.result.resourceTemplates.map((r: any) => r.uriTemplate)).toEqual(['planet://{id}'])
  })

  it('reads a static resource', async () => {
    const res = await send(createHandler(), 'resources/read', { uri: 'config://app' })
    expect(res.result.contents[0]).toMatchObject({ uri: 'config://app', mimeType: 'text/plain', text: 'debug=true' })
  })

  it('reads a templated resource, binding URI vars to input', async () => {
    const res = await send(createHandler(), 'resources/read', { uri: 'planet://earth' })
    expect(res.result.contents[0].uri).toBe('planet://earth')
    expect(JSON.parse(res.result.contents[0].text)).toEqual({ id: 'earth', name: 'Planet earth' })
  })

  it('returns RESOURCE_NOT_FOUND for an unmatched URI', async () => {
    const res = await send(createHandler(), 'resources/read', { uri: 'nope://x' })
    expect(res.error.code).toBe(RESOURCE_NOT_FOUND)
  })

  it('lists prompts with arguments derived from input', async () => {
    const res = await send(createHandler(), 'prompts/list')
    const prompt = res.result.prompts.find((p: any) => p.name === 'planTrip')
    expect(prompt.arguments).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'destination', required: true }),
      expect.objectContaining({ name: 'days', required: true }),
    ]))
  })

  it('gets a prompt and renders messages from the handler output', async () => {
    const res = await send(createHandler(), 'prompts/get', { name: 'planTrip', arguments: { destination: 'Paris', days: 3 } })
    expect(res.result.description).toBe('Plan a trip')
    expect(res.result.messages[0].content.text).toContain('Paris')
  })

  it('handles a JSON-RPC batch', async () => {
    const { responses } = await createHandler().handlePayload(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
      { context: {} },
    )
    // notification produces no response
    expect(responses).toHaveLength(2)
    expect(responses.map((r: any) => r.id)).toEqual([1, 2])
  })
})
