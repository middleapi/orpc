import type { JsonSchemaConverter } from '@orpc/json-schema'
import type { Context, Router } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { StandardBody, StandardLazyRequest } from '@standardserver/core'
import type { Readable, Writable } from 'node:stream'
import type { MCPHandlerPluginOptions } from '../standard/mcp-handler-plugin'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { StandardHandler } from '@orpc/server/standard'
import { stringifyJSON, toArray } from '@orpc/shared'
import { INVALID_REQUEST, JSONRPC_VERSION } from '../../constants'
import { createMCPRegistryProvider } from '../../registry'
import { MCPHandlerCodec } from '../standard/mcp-handler-codec'
import { MCPHandlerPlugin } from '../standard/mcp-handler-plugin'

const DEFAULT_MAX_MESSAGE_LENGTH = 4 * 1024 * 1024 // 4 MB

export interface MCPHandlerOptions<T extends Context> extends Omit<StandardHandlerOptions<T>, 'plugins'>, MCPHandlerPluginOptions {
  /** Schema → JSON Schema converters (e.g. `new ZodToJsonSchemaConverter()`). */
  converters?: JsonSchemaConverter[]
  plugins?: StandardHandlerPlugin<T>[]
  /** Reject a single stdio message longer than this (characters). @default 4_194_304 */
  maxMessageLength?: number
}

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
 * (newline-delimited JSON-RPC). Each line is dispatched through the same
 * {@link StandardHandler} + {@link MCPHandlerPlugin} as the HTTP adapters via a
 * synthesized request — one code path for every transport.
 *
 * @example
 * ```ts
 * await new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
 *   .listen({ context: {} })
 * ```
 */
export class MCPHandler<T extends Context> {
  private readonly handler: StandardHandler<T>
  private readonly maxMessageLength: number

  constructor(router: Router<T>, options: NoInfer<MCPHandlerOptions<T>> = {}) {
    const registry = createMCPRegistryProvider(router, { converters: options.converters })
    const codec = new MCPHandlerCodec<T>(registry)
    this.handler = new StandardHandler<T>(codec, {
      ...options,
      plugins: [new MCPHandlerPlugin<T>(registry, options), ...toArray(options.plugins)],
    })
    this.maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH
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
        if (trimmed.length > this.maxMessageLength) {
          writeMessage(output, { jsonrpc: JSONRPC_VERSION, id: null, error: { code: INVALID_REQUEST, message: 'Message too large' } })
          continue
        }

        const result = await this.handler.handle(synthesizeRequest(trimmed, options.signal), { context: options.context })
        if (result.matched && result.response.body !== undefined) {
          writeMessage(output, result.response.body)
        }
      }
    }
    finally {
      rl.close()
    }
  }
}

function synthesizeRequest(line: string, signal: AbortSignal | undefined): StandardLazyRequest {
  return {
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    signal,
    resolveBody: async () => JSON.parse(line) as StandardBody,
  }
}

function writeMessage(output: Writable, message: unknown): void {
  output.write(`${stringifyJSON(message) ?? ''}\n`)
}
