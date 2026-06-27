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

describe('mCPHandler (fetch)', () => {
  it('handles POST initialize with a 200 and a string protocolVersion', async () => {
    const req = postRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    const { response } = await createHandler().handle(req, { context: {} })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(typeof body.result.protocolVersion).toBe('string')
    expect(body.result.protocolVersion).toBe('2025-11-25')
    expect(body.result.serverInfo).toEqual({ name: 'test', version: '0.1.0' })
  })

  it('handles POST tools/call returning content as an array', async () => {
    const req = postRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'greet', arguments: { name: 'World' } } })
    const { response } = await createHandler().handle(req, { context: {} })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(Array.isArray(body.result.content)).toBe(true)
    expect(body.result.content[0]).toMatchObject({ type: 'text' })
    expect(body.result.content[0].text).toContain('Hello, World!')
    expect(body.result.structuredContent).toEqual({ message: 'Hello, World!' })
  })

  it('rejects a GET request with 405 Method Not Allowed', async () => {
    const req = new Request('https://x/mcp', { method: 'GET' })
    const { response } = await createHandler().handle(req, { context: {} })

    expect(response.status).toBe(405)
    expect(await response.text()).toBe('Method Not Allowed')
  })

  it('returns 400 with a parse error (-32700) for an invalid JSON body', async () => {
    const req = makeRequest('POST', 'not json')
    const { response } = await createHandler().handle(req, { context: {} })

    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error.code).toBe(-32700)
    expect(body.id).toBeNull()
  })

  it('acknowledges a notification (no id) with 202 and an empty body', async () => {
    const req = postRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const { response } = await createHandler().handle(req, { context: {} })

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('returns a JSON-RPC array for a batch request', async () => {
    const req = postRequest([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    const { response } = await createHandler().handle(req, { context: {} })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
    expect(body.map((r: any) => r.id)).toEqual([1, 2])
    expect(body[0].result).toEqual({})
    expect(Array.isArray(body[1].result.tools)).toBe(true)
    expect(body[1].result.tools.map((t: any) => t.name)).toContain('greet')
  })
})
