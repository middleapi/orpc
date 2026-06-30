import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import * as z from 'zod'
import { LATEST_PROTOCOL_VERSION, PARSE_ERROR } from '../../constants'
import { mcp } from '../../meta'
import { MCPHandler } from './mcp-handler'

const greet = os
  .meta(mcp.tool({ title: 'Greet', description: 'Greet a person' }))
  .input(z.object({ name: z.string() }))
  .output(z.object({ message: z.string() }))
  .handler(({ input }) => ({ message: `Hello, ${input.name}!` }))

const router = { greet }

describe('mCPHandler (node adapter, real server)', () => {
  let server: ReturnType<typeof createServer>
  let baseUrl: string

  beforeAll(async () => {
    const handler = new MCPHandler(router, {
      converters: [new ZodToJsonSchemaConverter()],
      serverInfo: { name: 'test', version: '0.1.0' },
    })

    server = createServer((req, res) => {
      void handler.handle(req, res, { context: {} })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, resolve)
    })

    const port = (server.address() as AddressInfo).port
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()))
    })
  })

  function rpc(method: string, params?: Record<string, unknown>): Promise<Response> {
    return fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  }

  it('handles a POST initialize request over HTTP', async () => {
    const res = await rpc('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION })
    expect(res.status).toBe(200)

    const json = await res.json() as any
    expect(typeof json.result.protocolVersion).toBe('string')
    expect(json.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(json.result.serverInfo).toEqual({ name: 'test', version: '0.1.0' })
    expect(json.id).toBe(1)
  })

  it('lists the MCP-opted tool over HTTP', async () => {
    const res = await rpc('tools/list')
    expect(res.status).toBe(200)

    const json = await res.json() as any
    expect(Array.isArray(json.result.tools)).toBe(true)

    const names = json.result.tools.map((t: any) => t.name)
    expect(names).toContain('greet')

    const greetTool = json.result.tools.find((t: any) => t.name === 'greet')
    expect(greetTool.title).toBe('Greet')
    expect(greetTool.inputSchema.type).toBe('object')
    expect(greetTool.inputSchema.properties).toHaveProperty('name')
  })

  it('rejects a GET request with HTTP 405', async () => {
    const res = await fetch(baseUrl, { method: 'GET' })
    await res.body?.cancel()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('returns a JSON-RPC parse error for invalid JSON with HTTP 400', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    })
    expect(res.status).toBe(400)

    const json = await res.json() as any
    expect(json.error.code).toBe(PARSE_ERROR)
    expect(json.error.code).toBe(-32700)
    expect(json.error.message).toBe('Parse error')
  })
})
