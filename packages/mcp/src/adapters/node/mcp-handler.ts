import type { JsonSchemaConverter } from '@orpc/json-schema'
import type { Context, Router } from '@orpc/server'
import type { NodeHttpHandlerOptions } from '@orpc/server/node'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { MCPHandlerPluginOptions } from '../standard/mcp-handler-plugin'
import { NodeHttpHandler } from '@orpc/server/node'
import { StandardHandler } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'
import { createMCPRegistryProvider } from '../../registry'
import { MCPHandlerCodec } from '../standard/mcp-handler-codec'
import { MCPHandlerPlugin } from '../standard/mcp-handler-plugin'

export interface MCPHandlerOptions<T extends Context>
  extends NodeHttpHandlerOptions<T>, Omit<StandardHandlerOptions<T>, 'plugins'>, MCPHandlerPluginOptions {
  /** Schema → JSON Schema converters (e.g. `new ZodToJsonSchemaConverter()`). */
  converters?: JsonSchemaConverter[]
}

/**
 * Serves an oRPC router as an MCP server over the Streamable HTTP transport on a
 * Node.js `http`/`https` server. The Node adapter reads/limits the request body
 * (`BodyLimitHandlerPlugin`) — no hand-rolled body parsing.
 *
 * @example
 * ```ts
 * const handler = new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
 * createServer((req, res) => handler.handle(req, res, { context: {} }))
 * ```
 */
export class MCPHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(router: Router<T>, options: NoInfer<MCPHandlerOptions<T>> = {}) {
    const registry = createMCPRegistryProvider(router, { converters: options.converters })
    const codec = new MCPHandlerCodec<T>(registry)
    const handler = new StandardHandler<T>(codec, {
      ...options,
      plugins: [new MCPHandlerPlugin<T>(registry, options), ...toArray(options.plugins)],
    })
    super(handler, options)
  }
}
