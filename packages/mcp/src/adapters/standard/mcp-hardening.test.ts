import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import * as z from 'zod'
import { mcp } from '../../meta'
import { createMCPRegistryProvider } from '../../registry'
import { MCPHandler } from '../fetch/mcp-handler'

const router = {
  t1: os.meta(mcp.tool({ description: 'one' })).input(z.object({})).handler(() => 1),
  t2: os.meta(mcp.tool({ description: 'two' })).input(z.object({})).handler(() => 2),
  t3: os.meta(mcp.tool({ description: 'three' })).input(z.object({})).handler(() => 3),
  cfg: os
    .meta(mcp.resource({ uri: 'config://app', mimeType: 'application/json' }))
    .output(z.object({ v: z.number() }))
    .handler(() => ({ v: 1 })),
}

function createHandler(options: Record<string, unknown> = {}) {
  return new MCPHandler(router as any, { converters: [new ZodToJsonSchemaConverter()], ...options })
}

async function send(h: MCPHandler<any>, message: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const { response } = await h.handle(
    new Request('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(message),
    }),
    { context: {} },
  )
  return response as Response
}

async function rpc(h: MCPHandler<any>, message: unknown, headers?: Record<string, string>): Promise<any> {
  return (await send(h, message, headers)).json()
}

describe('jSON-RPC id validation', () => {
  it('rejects a non-primitive (object) id with Invalid Request', async () => {
    const body = await rpc(createHandler(), { jsonrpc: '2.0', id: {}, method: 'ping' })
    expect(body.error.code).toBe(-32600)
  })

  it('rejects a boolean id', async () => {
    const body = await rpc(createHandler(), { jsonrpc: '2.0', id: false, method: 'ping' })
    expect(body.error.code).toBe(-32600)
  })

  it('treats a missing id as a notification (202, no body)', async () => {
    const res = await send(createHandler(), { jsonrpc: '2.0', method: 'ping' })
    expect(res.status).toBe(202)
  })
})

describe('catalog pagination hardening', () => {
  it('ignores a non-integer pageSize and falls back to the default', async () => {
    const body = await rpc(createHandler({ pageSize: 2.5 }), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(body.result.tools).toHaveLength(3)
    expect(body.result.nextCursor).toBeUndefined()
  })

  it('rejects a stale/out-of-range cursor with -32602', async () => {
    const body = await rpc(createHandler({ pageSize: 2 }), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { cursor: btoa('10') },
    })
    expect(body.error.code).toBe(-32602)
  })
})

describe('dNS-rebinding protection', () => {
  it('throws when enabled without any allowlist', () => {
    expect(() => createHandler({ enableDnsRebindingProtection: true })).toThrow(/allowedOrigins/)
  })

  it('rejects a disallowed Origin with 403', async () => {
    const h = createHandler({ enableDnsRebindingProtection: true, allowedOrigins: ['https://ok.test'] })
    const res = await send(h, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.test' })
    expect(res.status).toBe(403)
  })

  it('allows a permitted Origin', async () => {
    const h = createHandler({ enableDnsRebindingProtection: true, allowedOrigins: ['https://ok.test'] })
    const body = await rpc(h, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://ok.test' })
    expect(body.result).toEqual({})
  })
})

describe('resources/read error codes', () => {
  it('returns -32602 (invalid params) for a missing/non-string uri', async () => {
    const body = await rpc(createHandler(), { jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} })
    expect(body.error.code).toBe(-32602)
  })

  it('returns -32002 (resource not found) for a valid but unknown uri', async () => {
    const body = await rpc(createHandler(), { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'config://nope' } })
    expect(body.error.code).toBe(-32002)
  })
})

describe('completion capability', () => {
  it('does not handle completion/complete (it is not advertised) → method not found', async () => {
    const body = await rpc(createHandler(), { jsonrpc: '2.0', id: 1, method: 'completion/complete', params: {} })
    expect(body.error.code).toBe(-32601)
  })
})

describe('registry integrity', () => {
  it('throws on duplicate tool names', async () => {
    const dup = {
      a: os.meta(mcp.tool({ name: 'same' })).input(z.object({})).handler(() => 1),
      b: os.meta(mcp.tool({ name: 'same' })).input(z.object({})).handler(() => 2),
    }
    const provider = createMCPRegistryProvider(dup as any, { converters: [new ZodToJsonSchemaConverter()] })
    await expect(provider.get()).rejects.toThrow(/Duplicate MCP tool name/)
  })

  it('merges properties from multiple input schemas (allOf)', async () => {
    const multiRouter = {
      multi: os
        .meta(mcp.tool({ description: 'm' }))
        .input(z.object({ a: z.string() }))
        .input(z.object({ b: z.number() }))
        .handler(() => 1),
    }
    const provider = createMCPRegistryProvider(multiRouter as any, { converters: [new ZodToJsonSchemaConverter()] })
    const registry = await provider.get()
    const inputSchema = registry.tools.get('multi')!.definition.inputSchema
    expect(Object.keys(inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['a', 'b']))
  })
})
