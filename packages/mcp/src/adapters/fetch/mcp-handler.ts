import type { AnyRouter, Context } from '@orpc/server'
import type { JSONRPCResponse } from '../../types'
import type { StandardMCPHandlerOptions } from '../standard/mcp-handler'
import { stringifyJSON } from '@orpc/shared'
import { JSONRPC_VERSION, PARSE_ERROR } from '../../constants'
import { StandardMCPHandler } from '../standard/mcp-handler'

export interface MCPHandlerHandleOptions<T extends Context> {
  context: T
  signal?: AbortSignal
}

export interface MCPHandlerHandleResult {
  response: Response
}

/**
 * Serves an oRPC router as an MCP server over the Streamable HTTP transport
 * (POST JSON-RPC) on a Fetch-compatible runtime (Bun, Deno, Workers, Next.js…).
 *
 * @example
 * ```ts
 * const handler = new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
 * const { response } = await handler.handle(request, { context: {} })
 * return response
 * ```
 */
export class MCPHandler<T extends Context> {
  private readonly standardHandler: StandardMCPHandler<T>

  constructor(router: AnyRouter, options: StandardMCPHandlerOptions = {}) {
    this.standardHandler = new StandardMCPHandler<T>(router, options)
  }

  async handle(request: Request, options: MCPHandlerHandleOptions<T>): Promise<MCPHandlerHandleResult> {
    if (request.method === 'GET') {
      // Server -> client SSE stream is not implemented yet.
      return { response: new Response('Method Not Allowed', { status: 405 }) }
    }

    let payload: unknown
    try {
      payload = await request.json()
    }
    catch {
      return {
        response: jsonResponse(
          { jsonrpc: JSONRPC_VERSION, id: null, error: { code: PARSE_ERROR, message: 'Parse error' } },
          400,
        ),
      }
    }

    const { responses, isBatch } = await this.standardHandler.handlePayload(payload, {
      context: options.context,
      signal: options.signal ?? request.signal,
    })

    if (responses.length === 0) {
      // Only notifications/responses were sent — acknowledge with 202.
      return { response: new Response(null, { status: 202 }) }
    }

    const body: JSONRPCResponse | JSONRPCResponse[] = isBatch ? responses : responses[0]!
    return { response: jsonResponse(body, 200) }
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(stringifyJSON(body) ?? '', {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
