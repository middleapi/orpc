import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import * as z from 'zod'
import { mcp } from '../../meta'
import { MCPHandler } from './mcp-handler'

const greet = os
  .meta(mcp.tool({ title: 'Greet', description: 'Greet a person' }))
  .input(z.object({ name: z.string() }))
  .output(z.object({ message: z.string() }))
  .handler(({ input }) => ({ message: `Hello, ${input.name}!` }))

const router = { greet }

function createHandler() {
  return new MCPHandler(router, {
    converters: [new ZodToJsonSchemaConverter()],
    serverInfo: { name: 'test', version: '0.1.0' },
  })
}

function makeRequest(method: string, body: string): Request {
  return new Request('https://x/mcp', {
    method,
    body,
    headers: { 'content-type': 'application/json' },
  })
}

function postRequest(payload: unknown): Request {
  return makeRequest('POST', JSON.stringify(payload))
}

async function handle(handler: MCPHandler<any>, request: Request): Promise<Response> {
  const { response } = await handler.handle(request, { context: {} })
  expect(response).toBeDefined()
  return response as Response
}

describe('mCPHandler (fetch)', () => {
  it('handles POST initialize with a 200 and a string protocolVersion', async () => {
    const response = await handle(createHandler(), postRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }))

    expect(response.status).toBe(200)

    const body: any = await response.json()
    expect(typeof body.result.protocolVersion).toBe('string')
    expect(body.result.protocolVersion).toBe('2025-11-25')
    expect(body.result.serverInfo).toEqual({ name: 'test', version: '0.1.0' })
  })

  it('handles POST tools/call returning content as an array', async () => {
    const response = await handle(createHandler(), postRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'greet', arguments: { name: 'World' } } }))

    expect(response.status).toBe(200)

    const body: any = await response.json()
    expect(Array.isArray(body.result.content)).toBe(true)
    expect(body.result.content[0]).toMatchObject({ type: 'text' })
    expect(body.result.content[0].text).toContain('Hello, World!')
    expect(body.result.structuredContent).toEqual({ message: 'Hello, World!' })
  })

  it('rejects a GET request with 405 Method Not Allowed', async () => {
    const response = await handle(createHandler(), new Request('https://x/mcp', { method: 'GET' }))

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('returns 400 with a parse error (-32700) for an invalid JSON body', async () => {
    const response = await handle(createHandler(), makeRequest('POST', 'not json'))

    expect(response.status).toBe(400)

    const body: any = await response.json()
    expect(body.error.code).toBe(-32700)
    expect(body.id).toBeNull()
  })

  it('acknowledges a notification (no id) with 202 and an empty body', async () => {
    const response = await handle(createHandler(), postRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }))

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('rejects JSON-RPC batches with 400 (-32600) — batching is unsupported', async () => {
    const response = await handle(createHandler(), postRequest([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]))

    expect(response.status).toBe(400)

    const body: any = await response.json()
    expect(body.error.code).toBe(-32600)
    expect(body.id).toBeNull()
  })

  it('validates the Origin header when DNS-rebinding protection is enabled', async () => {
    const handler = new MCPHandler(router, {
      converters: [new ZodToJsonSchemaConverter()],
      enableDnsRebindingProtection: true,
      allowedOrigins: ['https://trusted.example'],
    })

    // A disallowed Origin is rejected with 403.
    const blockedResponse = await handle(handler, new Request('https://x/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      headers: { 'content-type': 'application/json', 'origin': 'https://evil.example' },
    }))
    expect(blockedResponse.status).toBe(403)

    // A missing Origin (non-browser client) still passes.
    const okResponse = await handle(handler, makeRequest('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })))
    expect(okResponse.status).toBe(200)
  })
})
