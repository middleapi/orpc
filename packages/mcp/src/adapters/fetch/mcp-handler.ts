import type { JsonSchemaConverter } from '@orpc/json-schema'
import type { Context, Router } from '@orpc/server'
import type { FetchHandlerOptions } from '@orpc/server/fetch'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { MCPHandlerPluginOptions } from '../standard/mcp-handler-plugin'
import { FetchHandler } from '@orpc/server/fetch'
import { StandardHandler } from '@orpc/server/standard'
import { toArray } from '@orpc/shared'
import { createMCPRegistryProvider } from '../../registry'
import { MCPHandlerCodec } from '../standard/mcp-handler-codec'
import { MCPHandlerPlugin } from '../standard/mcp-handler-plugin'

export interface MCPHandlerOptions<T extends Context>
  extends FetchHandlerOptions<T>, Omit<StandardHandlerOptions<T>, 'plugins'>, MCPHandlerPluginOptions {
  /** Schema → JSON Schema converters (e.g. `new ZodToJsonSchemaConverter()`). */
  converters?: JsonSchemaConverter[]
}

/**
 * Serves an oRPC router as an MCP server over the Streamable HTTP transport
 * (POST JSON-RPC) on a Fetch-compatible runtime (Bun, Deno, Workers, Next.js…).
 *
 * Built on oRPC's {@link StandardHandler}: `tools/call` / `resources/read` /
 * `prompts/get` run through the standard procedure pipeline (middleware,
 * validation, context, plugins), while {@link MCPHandlerPlugin} answers the
 * MCP protocol routes (`initialize`, the `list` methods, …).
 *
 * @example
 * ```ts
 * const handler = new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
 * const { response } = await handler.handle(request, { context: {} })
 * return response ?? new Response('Not found', { status: 404 })
 * ```
 */
export class MCPHandler<T extends Context> extends FetchHandler<T> {
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
