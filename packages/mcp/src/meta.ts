import type { AnyProcedureContract, AnySchema, ErrorMap, Meta, MetaPlugin } from '@orpc/contract'
import type { Lazy } from '@orpc/server'

/**
 * Which MCP primitive a procedure is exposed as.
 *
 * @default 'tool'
 */
export type MCPPrimitiveType = 'tool' | 'resource' | 'prompt'

/**
 * MCP tool behavior hints. Purely advisory metadata for clients/agents.
 *
 * @see https://modelcontextprotocol.io/specification/2025-11-25/server/tools
 */
export interface MCPToolAnnotations {
  /** If true, the tool does not modify its environment. */
  readOnlyHint?: boolean | undefined
  /** If true, the tool may perform destructive updates (only meaningful when not read-only). */
  destructiveHint?: boolean | undefined
  /** If true, repeated calls with the same arguments have no additional effect. */
  idempotentHint?: boolean | undefined
  /** If true, the tool may interact with an open/unbounded set of external entities. */
  openWorldHint?: boolean | undefined
}

/**
 * Metadata attached to a procedure via {@link mcp} so it is exposed over MCP.
 *
 * The shape is intentionally flat (mirroring `OpenAPIMeta`); fields that don't
 * apply to the chosen {@link MCPPrimitiveType} are ignored by the handler.
 */
export interface MCPMeta {
  /**
   * Which MCP primitive this procedure maps to.
   *
   * @default 'tool'
   */
  type?: MCPPrimitiveType | undefined

  /**
   * Unique name within the server for this tool/resource/prompt.
   *
   * @default Router segments joined by `'_'` (kept within MCP's `^[a-zA-Z0-9_-]{1,128}$`).
   */
  name?: string | undefined

  /** Human-readable display name shown to users. */
  title?: string | undefined

  /** Detailed description used by the model to decide when/how to use this. */
  description?: string | undefined

  /** Tool-only: behavior hints. Merged when defined multiple times. */
  annotations?: MCPToolAnnotations | undefined

  /**
   * Tool-only: whether to emit an MCP `outputSchema` from the procedure's
   * `.output()` schema (enables `structuredContent`).
   *
   * @default true when an output schema is defined
   */
  outputSchema?: boolean | undefined

  /** Resource-only: MIME type of the resource contents. */
  mimeType?: string | undefined

  /** Resource-only: fixed URI of a static resource (e.g. `config://app`). */
  uri?: `${string}://${string}` | undefined

  /** Resource-only: RFC 6570-style URI template (e.g. `planet://{id}`); vars map to input. */
  uriTemplate?: string | undefined
}

export interface MCPMetaPlugin<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends MetaPlugin<TInputSchema, TOutputSchema, TErrorMap> {
  name: '~mcp'
}

/** Author-facing meta for {@link mcp.tool}. */
export type MCPToolMetaInput = Omit<MCPMeta, 'type' | 'uri' | 'uriTemplate' | 'mimeType'>

/** Author-facing meta for {@link mcp.prompt}. */
export type MCPPromptMetaInput = Omit<MCPMeta, 'type' | 'uri' | 'uriTemplate' | 'mimeType' | 'annotations' | 'outputSchema'>

/** Author-facing meta for {@link mcp.resource} — requires exactly one of `uri` / `uriTemplate`. */
export type MCPResourceMetaInput
  = & Omit<MCPMeta, 'type' | 'annotations' | 'outputSchema' | 'uri' | 'uriTemplate'>
    & (
      | { uri: `${string}://${string}`, uriTemplate?: never }
      | { uriTemplate: string, uri?: never }
  )

export interface MCPNamespace {
  /** Expose a procedure as an MCP tool (the most common primitive). */
  tool: (meta?: MCPToolMetaInput) => MCPMetaPlugin<any, any, any>
  /** Expose a (read-only) procedure as an MCP resource. Requires `uri` or `uriTemplate`. */
  resource: (meta: MCPResourceMetaInput) => MCPMetaPlugin<any, any, any>
  /** Expose a procedure as an MCP prompt. Arguments are derived from `.input()`. */
  prompt: (meta?: MCPPromptMetaInput) => MCPMetaPlugin<any, any, any>
}

function createMCPMetaPlugin(incoming: MCPMeta): MCPMetaPlugin<any, any, any> {
  return {
    name: '~mcp',
    init(meta: Meta): Meta {
      const existing = meta['~mcp'] as MCPMeta | undefined

      const annotations = existing?.annotations && incoming.annotations
        ? { ...existing.annotations, ...incoming.annotations }
        : 'annotations' in incoming ? incoming.annotations : existing?.annotations

      const merged: MCPMeta = {
        ...existing,
        ...incoming,
        ...(annotations !== undefined ? { annotations } : {}),
      }

      return {
        ...meta,
        '~mcp': merged,
      }
    },
  }
}

/**
 * Expose a procedure over MCP (opt-in). Use one of `mcp.tool` / `mcp.resource` /
 * `mcp.prompt` — there is no bare `mcp()` form.
 *
 * Each writes a single `~mcp` meta key (independent of any `openapi()` meta on the
 * same procedure); calling more than once merges (annotations shallow-merge,
 * other fields overwrite).
 *
 * @example
 * ```ts
 * const createPlanet = os
 *   .meta(mcp.tool({ description: 'Create a planet' }))
 *   .input(CreatingPlanetSchema)
 *   .output(PlanetSchema)
 *   .handler(...)
 * ```
 */
export const mcp: MCPNamespace = {
  tool: (meta = {}) => createMCPMetaPlugin({ ...meta, type: 'tool' }),
  resource: meta => createMCPMetaPlugin({ ...meta, type: 'resource' }),
  prompt: (meta = {}) => createMCPMetaPlugin({ ...meta, type: 'prompt' }),
}

/**
 * Read the MCP meta a procedure (or lazy router) was annotated with, if any.
 * Returns `undefined` when the procedure is not opted into MCP.
 */
export function getMCPMeta(procedureOrLazy: AnyProcedureContract | Lazy<any>): MCPMeta | undefined {
  return procedureOrLazy['~orpc'].meta['~mcp'] as MCPMeta | undefined
}

/** Resolve the effective primitive type for an MCP meta (defaults to `'tool'`). */
export function getMCPPrimitiveType(meta: MCPMeta): MCPPrimitiveType {
  return meta.type ?? 'tool'
}
