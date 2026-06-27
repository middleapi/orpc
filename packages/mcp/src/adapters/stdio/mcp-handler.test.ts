import { Readable, Writable } from 'node:stream'
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
  return new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
}

/**
 * Feed `lines` (already terminated with `\n` as needed) through the stdio
 * handler and return the parsed JSON-RPC response lines, in order.
 */
async function drive(handler: MCPHandler<Record<never, never>>, payload: string): Promise<any[]> {
  const input = Readable.from([payload])
  const chunks: string[] = []
  const output = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString())
      cb()
    },
  })

  await handler.listen({ context: {}, input, output })

  const joined = chunks.join('').trim()
  if (joined.length === 0) {
    return []
  }
  return joined.split('\n').map(line => JSON.parse(line))
}

describe('mCPHandler (stdio)', () => {
  it('responds to a single initialize line with exactly one response', async () => {
    const line = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`
    const responses = await drive(createHandler(), line)

    expect(responses).toHaveLength(1)
    expect(responses[0].jsonrpc).toBe('2.0')
    expect(responses[0].id).toBe(1)
    expect(typeof responses[0].result.protocolVersion).toBe('string')
  })

  it('processes multiple lines and emits responses in order', async () => {
    const payload
      = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`
        + `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`
    const responses = await drive(createHandler(), payload)

    expect(responses).toHaveLength(2)
    expect(responses.map(r => r.id)).toEqual([1, 2])
    expect(typeof responses[0].result.protocolVersion).toBe('string')
    expect(Array.isArray(responses[1].result.tools)).toBe(true)
    expect(responses[1].result.tools.map((t: any) => t.name)).toEqual(['greet'])
  })

  it('ignores blank lines without crashing or emitting extra output', async () => {
    const payload
      = `\n`
        + `   \n`
        + `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`
        + `\n`
    const responses = await drive(createHandler(), payload)

    expect(responses).toHaveLength(1)
    expect(responses[0].id).toBe(1)
  })

  it('emits a parse error for an invalid JSON line', async () => {
    const payload = `this is not json\n`
    const responses = await drive(createHandler(), payload)

    expect(responses).toHaveLength(1)
    expect(responses[0].jsonrpc).toBe('2.0')
    expect(responses[0].id).toBe(null)
    expect(responses[0].error.code).toBe(-32700)
    expect(responses[0].error.message).toBe('Parse error')
  })

  it('recovers after an invalid JSON line and keeps processing valid lines', async () => {
    const payload
      = `not json at all\n`
        + `${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} })}\n`
    const responses = await drive(createHandler(), payload)

    expect(responses).toHaveLength(2)
    expect(responses[0].error.code).toBe(-32700)
    expect(responses[1].id).toBe(7)
    expect(typeof responses[1].result.protocolVersion).toBe('string')
  })
})
