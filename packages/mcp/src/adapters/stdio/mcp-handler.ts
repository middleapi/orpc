import type { AnyRouter, Context } from '@orpc/server'
import type { Readable, Writable } from 'node:stream'
import type { StandardMCPHandlerOptions } from '../standard/mcp-handler'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { stringifyJSON } from '@orpc/shared'
import { JSONRPC_VERSION, PARSE_ERROR } from '../../constants'
import { StandardMCPHandler } from '../standard/mcp-handler'

export interface MCPHandlerListenOptions<T extends Context> {
  context: T
  signal?: AbortSignal
  /** Defaults to `process.stdin`. */
  input?: Readable
  /** Defaults to `process.stdout`. */
  output?: Writable
}

/**
 * Serves an oRPC router as an MCP server over the stdio transport
 * (newline-delimited JSON-RPC on stdin/stdout) — the transport local MCP
 * clients (Claude Desktop, IDEs) use to launch a server subprocess.
 *
 * @example
 * ```ts
 * await new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
 *   .listen({ context: {} })
 * ```
 */
export class MCPHandler<T extends Context> {
  private readonly standardHandler: StandardMCPHandler<T>

  constructor(router: AnyRouter, options: StandardMCPHandlerOptions = {}) {
    this.standardHandler = new StandardMCPHandler<T>(router, options)
  }

  async listen(options: MCPHandlerListenOptions<T>): Promise<void> {
    const input = options.input ?? process.stdin
    const output = options.output ?? process.stdout
    const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })

    try {
      for await (const line of rl) {
        const trimmed = line.trim()
        if (trimmed.length === 0) {
          continue
        }

        let payload: unknown
        try {
          payload = JSON.parse(trimmed)
        }
        catch {
          writeMessage(output, {
            jsonrpc: JSONRPC_VERSION,
            id: null,
            error: { code: PARSE_ERROR, message: 'Parse error' },
          })
          continue
        }

        const { responses } = await this.standardHandler.handlePayload(payload, {
          context: options.context,
          signal: options.signal,
        })
        for (const response of responses) {
          writeMessage(output, response)
        }
      }
    }
    finally {
      rl.close()
    }
  }
}

function writeMessage(output: Writable, message: unknown): void {
  output.write(`${stringifyJSON(message) ?? ''}\n`)
}
