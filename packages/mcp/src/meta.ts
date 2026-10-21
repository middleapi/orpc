import type { Icon, ToolAnnotations } from '@modelcontextprotocol/server'
import type { AnyProcedureContract, AnySchema, ErrorMap, MetaPlugin } from '@orpc/contract'
import type { Lazy } from '@orpc/server'

/**
 * [MCP Tool](https://modelcontextprotocol.io/specification/latest/server/tools) options attached to a procedure/contract,
 * used when registering it as a tool.
 *
 * @remarks
 * Fields left undefined fall back to the procedure's [OpenAPI meta](https://orpc.dev/docs/openapi/specification#metadata),
 * so procedures already documented for OpenAPI need no extra meta.
 *
 * @see {@link https://orpc.dev/docs/integrations/mcp#tool-meta | MCP Integration - Tool Meta}
 */
export interface McpToolMeta {
  /**
   * Unique name of the tool within the MCP server.
   *
   * @default OpenAPI `operationId`, otherwise router segments joined by `_`
   */
  name?: string | undefined

  /**
   * Human-readable title of the tool, shown in client UIs.
   *
   * @default OpenAPI `summary`
   */
  title?: string | undefined

  /**
   * Description of what the tool does, read by the model to decide when to call it.
   *
   * @default OpenAPI `description`, otherwise OpenAPI `summary`
   */
  description?: string | undefined

  /**
   * Hints that describe the tool's behavior to clients.
   *
   * Hints inferred from the OpenAPI `method` are applied first:
   * `GET`, `HEAD`, and `QUERY` imply `readOnlyHint: true`,
   * `PUT` and `DELETE` imply `idempotentHint: true`.
   *
   * **Merging**: When defined multiple times, hints are merged, the most recent value for a hint wins.
   * Explicitly setting `undefined` resets the annotations instead of merging.
   */
  annotations?: ToolAnnotations | undefined

  /**
   * Icons representing the tool in client UIs.
   */
  icons?: Icon[] | undefined

  /**
   * Arbitrary metadata attached to the tool definition.
   */
  _meta?: Record<string, unknown> | undefined
}

export interface McpToolMetaPlugin<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends MetaPlugin<TInputSchema, TOutputSchema, TErrorMap> {
  name: '~mcp/tool'
}

export interface McpToolFunction {
  (meta: McpToolMeta): McpToolMetaPlugin<any, any, any>
}

export interface McpMetaFunctions {
  /**
   * Attaches [MCP Tool](https://modelcontextprotocol.io/specification/latest/server/tools) options
   * to a procedure/contract, used when registering it as a tool.
   *
   * @remarks
   * - Fields left undefined fall back to the procedure's OpenAPI meta.
   * - When defined multiple times, options are overridden by the most recent call,
   *   except `annotations`, which are merged per hint.
   *
   * @example
   * ```ts
   * const getWeather = os
   *   .meta(mcp.tool({
   *     name: 'get_weather',
   *     description: 'Get the current weather in a location',
   *     annotations: { openWorldHint: true },
   *   }))
   *   .input(z.object({ location: z.string() }))
   *   .handler(async ({ input }) => ({ temperature: 21 }))
   * ```
   *
   * @see {@link https://orpc.dev/docs/integrations/mcp#tool-meta | MCP Integration - Tool Meta}
   */
  tool: McpToolFunction
}

/**
 * Creates meta plugins that control how a procedure/contract is exposed on MCP servers,
 * such as `mcp.tool(...)` for its tool definition.
 *
 * @see {@link https://orpc.dev/docs/integrations/mcp#tool-meta | MCP Integration - Tool Meta}
 */
export const mcp: McpMetaFunctions = {
  tool: incoming => ({
    name: '~mcp/tool',
    init(meta) {
      const existing = meta['~mcp/tool'] as undefined | McpToolMeta

      const merged: McpToolMeta = { ...existing, ...incoming }

      if (existing?.annotations && incoming.annotations) {
        merged.annotations = { ...existing.annotations, ...incoming.annotations }
      }

      return {
        ...meta,
        '~mcp/tool': merged,
      }
    },
  }),
}

/**
 * Reads the [MCP Tool](https://modelcontextprotocol.io/specification/latest/server/tools) options
 * attached to a procedure/contract by `mcp.tool`.
 *
 * @see {@link https://orpc.dev/docs/integrations/mcp#tool-meta | MCP Integration - Tool Meta}
 */
export function getMcpToolMeta(procedureOrLazy: AnyProcedureContract | Lazy<any>): McpToolMeta | undefined {
  return procedureOrLazy['~orpc'].meta['~mcp/tool'] as McpToolMeta | undefined
}
