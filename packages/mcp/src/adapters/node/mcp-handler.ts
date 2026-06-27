import type { AnyRouter, Context } from '@orpc/server'
import type { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { StandardMCPHandlerOptions } from '../standard/mcp-handler'
import { stringifyJSON } from '@orpc/shared'
import { JSONRPC_VERSION, METHOD_NOT_FOUND, PARSE_ERROR } from '../../constants'
import { StandardMCPHandler } from '../standard/mcp-handler'

export interface MCPHandlerHandleOptions<T extends Context> {
  context: T
  signal?: AbortSignal
}

export interface MCPHandlerHandleResult {
  matched: true
}

/**
 * Serves an oRPC router as an MCP server over the Streamable HTTP transport
 * on a Node.js `http`/`https` server.
 *
 * @example
 * ```ts
 * const handler = new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
 * createServer((req, res) => handler.handle(req, res, { context: {} }))
 * ```
 */
export class MCPHandler<T extends Context> {
  private readonly standardHandler: StandardMCPHandler<T>

  constructor(router: AnyRouter, options: StandardMCPHandlerOptions = {}) {
    this.standardHandler = new StandardMCPHandler<T>(router, options)
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: MCPHandlerHandleOptions<T>,
  ): Promise<MCPHandlerHandleResult> {
    if (request.method === 'GET') {
      sendJson(response, 405, {
        jsonrpc: JSONRPC_VERSION,
        id: null,
        error: { code: METHOD_NOT_FOUND, message: 'Method Not Allowed' },
      })
      return { matched: true }
    }

    let payload: unknown
    try {
      payload = JSON.parse(await readBody(request))
    }
    catch {
      sendJson(response, 400, {
        jsonrpc: JSONRPC_VERSION,
        id: null,
        error: { code: PARSE_ERROR, message: 'Parse error' },
      })
      return { matched: true }
    }

    const { responses, isBatch } = await this.standardHandler.handlePayload(payload, {
      context: options.context,
      signal: options.signal,
    })

    if (responses.length === 0) {
      response.statusCode = 202
      response.end()
      return { matched: true }
    }

    sendJson(response, 200, isBatch ? responses : responses[0])
    return { matched: true }
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    request.on('data', (chunk: Buffer | string) => {
      data += chunk
    })
    request.on('end', () => resolve(data))
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(stringifyJSON(body) ?? '')
}
