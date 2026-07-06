import type { AnyORPCError } from '@orpc/client'
import type { Context } from '@orpc/server'
import type {
  StandardHandlerHandleResult,
  StandardHandlerOptions,
  StandardHandlerPlugin,
  StandardHandlerRoutingInterceptorOptions,
} from '@orpc/server/standard'
import type { InterceptorOptions } from '@orpc/shared'
import type { StandardBody, StandardLazyRequest } from '@standardserver/core'
import type { MCPRegistry, MCPRegistryProvider } from '../../registry'
import type {
  Implementation,
  InitializeResult,
  JSONRPCErrorObject,
  JSONRPCIncoming,
  ServerCapabilities,
} from '../../types'
import type { MCPCodecBody } from './mcp-handler-codec'
import { flattenStandardHeader } from '@standardserver/core'
import {
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_VERSION,
  FORBIDDEN_ERROR,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  RESOURCE_NOT_FOUND,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../../constants'
import { encodePromptMessages, encodeResourceContents, encodeToolResult } from '../../content'
import { JSONRPCError, orpcErrorToJSONRPCError } from '../../error'
import { isObject, isValidIncoming, withResolvedBody } from './utils'

const PROCEDURE_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get'])

export interface MCPHandlerPluginOptions {
  /** Server identity reported during `initialize`. */
  serverInfo?: Partial<Implementation>
  /** Optional `instructions` returned to the client during `initialize`. */
  instructions?: string
  /**
   * Enable Origin/Host validation (DNS-rebinding protection) for HTTP transports.
   * A missing `Origin` header always passes (non-browser clients). When enabled,
   * a present `Origin`/`Host` not in the corresponding allowlist is rejected (403).
   *
   * @default false
   */
  enableDnsRebindingProtection?: boolean
  /** Allowed `Origin` header values (exact match) when protection is enabled. */
  allowedOrigins?: string[]
  /** Allowed `Host` header values (exact match) when protection is enabled. */
  allowedHosts?: string[]
  /**
   * Page size for catalog pagination of the `list` methods (`tools/list`,
   * `resources/list`, `resources/templates/list`, `prompts/list`). Catalogs at
   * or under this size return a single page.
   *
   * @default 100
   */
  pageSize?: number
}

/**
 * Auto-registered plugin that turns a {@link StandardHandler} into an MCP server.
 *
 * It installs a routing interceptor that owns the JSON-RPC envelope:
 * - protocol methods (`initialize`, `ping`, the `list` methods, `completion/complete`,
 *   `notifications/*`) are answered with an early response (no procedure call);
 * - procedure methods (`tools/call`, `resources/read`, `prompts/get`) fall
 *   through to {@link MCPHandlerCodec} via `next()` (the standard procedure
 *   pipeline), then this plugin shapes the MCP result and frames the JSON-RPC
 *   envelope with the request `id`.
 */
export class MCPHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  readonly name = '~mcp'

  private readonly serverInfo: Implementation
  private readonly instructions: string | undefined
  private readonly enableDnsRebindingProtection: boolean
  private readonly allowedOrigins: string[] | undefined
  private readonly allowedHosts: string[] | undefined
  private readonly pageSize: number

  constructor(
    private readonly registry: MCPRegistryProvider,
    options: MCPHandlerPluginOptions = {},
  ) {
    this.serverInfo = {
      name: options.serverInfo?.name ?? DEFAULT_SERVER_NAME,
      version: options.serverInfo?.version ?? DEFAULT_SERVER_VERSION,
      ...(options.serverInfo?.title !== undefined ? { title: options.serverInfo.title } : {}),
    }
    this.instructions = options.instructions
    this.enableDnsRebindingProtection = options.enableDnsRebindingProtection ?? false
    this.allowedOrigins = options.allowedOrigins
    this.allowedHosts = options.allowedHosts
    // Fail loud on a no-op security config: enabling protection without any
    // allowlist would otherwise silently allow every Origin/Host.
    if (this.enableDnsRebindingProtection && this.allowedOrigins === undefined && this.allowedHosts === undefined) {
      throw new TypeError('`enableDnsRebindingProtection` requires `allowedOrigins` and/or `allowedHosts` to be set.')
    }
    this.pageSize = options.pageSize !== undefined && Number.isInteger(options.pageSize) && options.pageSize > 0
      ? options.pageSize
      : DEFAULT_LIST_PAGE_SIZE
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      routingInterceptors: [
        ...(options.routingInterceptors ?? []),
        interceptorOptions => this.route(interceptorOptions),
      ],
    }
  }

  private async route(
    options: InterceptorOptions<StandardHandlerRoutingInterceptorOptions<T>, Promise<StandardHandlerHandleResult>>,
  ): Promise<StandardHandlerHandleResult> {
    const { request, next } = options

    // 1. DNS-rebinding / Origin protection (no-op for stdio / non-browser clients).
    if (!this.checkSecurity(request)) {
      return jsonRpc(403, null, { error: { code: FORBIDDEN_ERROR, message: 'Origin not allowed' } })
    }

    // 2. MCP uses HTTP POST. (GET SSE / DELETE sessions are not implemented yet.)
    if (request.method !== 'POST') {
      return { matched: true, response: { status: 405, headers: { allow: 'POST' }, body: undefined } }
    }

    // 3. Parse the JSON-RPC envelope (single body read for the whole pipeline).
    let payload: unknown
    try {
      payload = await request.resolveBody('json')
    }
    catch {
      return jsonRpc(400, null, { error: { code: PARSE_ERROR, message: 'Parse error' } })
    }

    // 4. Batching is intentionally unsupported (incompatible with the standard
    //    one-request/one-procedure flow and deprecated in the MCP spec direction).
    if (Array.isArray(payload)) {
      return jsonRpc(400, null, { error: { code: INVALID_REQUEST, message: 'JSON-RPC batching is not supported' } })
    }

    if (!isValidIncoming(payload)) {
      return jsonRpc(400, null, { error: { code: INVALID_REQUEST, message: 'Invalid Request' } })
    }

    const id = 'id' in payload ? payload.id : undefined

    // 5. Notification (no id) — acknowledge with 202, no body.
    if (id === undefined) {
      return { matched: true, response: { status: 202, headers: {}, body: undefined } }
    }

    try {
      // 6. Procedure methods → standard pipeline via the codec, then frame. The
      //    codec re-reads the body to resolve its procedure; hand it a request
      //    with the parse already baked in so it shares this single read.
      if (PROCEDURE_METHODS.has(payload.method)) {
        return await this.frameProcedure(
          payload,
          id,
          () => next({ ...options, request: withResolvedBody(request, payload) }),
        )
      }

      // 7. Protocol methods → early response.
      const result = await this.handleProtocol(payload)
      return jsonRpc(200, id, { result })
    }
    catch (error) {
      const jsonRpcError = error instanceof JSONRPCError
        ? error
        : new JSONRPCError(INTERNAL_ERROR, error instanceof Error ? error.message : 'Internal error')
      return jsonRpc(200, id, { error: jsonRpcError.toJSON() })
    }
  }

  private async frameProcedure(
    message: JSONRPCIncoming,
    id: string | number,
    next: () => Promise<StandardHandlerHandleResult>,
  ): Promise<StandardHandlerHandleResult> {
    const result = await next()
    const params = isObject(message.params) ? message.params : {}

    if (!result.matched) {
      return jsonRpc(200, id, { error: this.notFound(message.method, params) })
    }

    const codecBody = result.response.body as unknown as MCPCodecBody
    const registry = await this.registry.get()

    if (codecBody.kind === 'error') {
      const error = codecBody.error as AnyORPCError
      // Tool errors are reported in-band (so the model can react); resource and
      // prompt errors are protocol-level JSON-RPC errors.
      if (message.method === 'tools/call') {
        return jsonRpc(200, id, { result: { content: [{ type: 'text', text: error.message }], isError: true } })
      }
      return jsonRpc(200, id, { error: orpcErrorToJSONRPCError(error).toJSON() })
    }

    return jsonRpc(200, id, { result: this.shapeProcedureResult(message.method, params, codecBody.output, registry) })
  }

  private shapeProcedureResult(method: string, params: Record<string, unknown>, output: unknown, registry: MCPRegistry): unknown {
    if (method === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : ''
      const hasOutputSchema = registry.tools.get(name)?.definition.outputSchema !== undefined
      return encodeToolResult(output, hasOutputSchema)
    }
    if (method === 'resources/read') {
      const uri = typeof params.uri === 'string' ? params.uri : ''
      return { contents: encodeResourceContents(output, uri, this.resourceMimeType(uri, registry)) }
    }
    // prompts/get
    const name = typeof params.name === 'string' ? params.name : ''
    const description = registry.prompts.get(name)?.meta.description
    const result = encodePromptMessages(output)
    return description !== undefined && result.description === undefined ? { description, ...result } : result
  }

  private resourceMimeType(uri: string, registry: MCPRegistry): string | undefined {
    const staticEntry = registry.resources.get(uri)
    if (staticEntry !== undefined) {
      return staticEntry.meta.mimeType
    }
    for (const entry of registry.resourceTemplates) {
      if (entry.template.match(uri) !== undefined) {
        return entry.meta.mimeType
      }
    }
    return undefined
  }

  private notFound(method: string, params: Record<string, unknown>): JSONRPCErrorObject {
    if (method === 'resources/read') {
      // A malformed request (missing/non-string uri) is invalid params, not a
      // "resource not found"; reserve -32002 for syntactically valid URIs.
      if (typeof params.uri !== 'string') {
        return { code: INVALID_PARAMS, message: 'resources/read requires a string "uri"' }
      }
      return { code: RESOURCE_NOT_FOUND, message: `Resource not found: ${params.uri}`, data: { uri: params.uri } }
    }
    const kind = method === 'prompts/get' ? 'prompt' : 'tool'
    return { code: INVALID_PARAMS, message: `Unknown ${kind}: ${String(params.name)}` }
  }

  /** Apply opaque-cursor catalog pagination to a list result. */
  private paginate(items: unknown[], key: string, cursor: unknown): Record<string, unknown> {
    const offset = decodeCursor(cursor)
    // A valid cursor always points within the catalog (nextCursor is only emitted
    // when more items remain), so an out-of-range offset is a stale/invalid cursor.
    if (offset > 0 && offset >= items.length) {
      throw new JSONRPCError(INVALID_PARAMS, 'Invalid cursor')
    }
    const page = items.slice(offset, offset + this.pageSize)
    const result: Record<string, unknown> = { [key]: page }
    if (offset + this.pageSize < items.length) {
      result.nextCursor = encodeCursor(offset + this.pageSize)
    }
    return result
  }

  private async handleProtocol(message: JSONRPCIncoming): Promise<unknown> {
    const params = isObject(message.params) ? message.params : {}
    switch (message.method) {
      case 'initialize':
        return this.initialize(params)
      case 'ping':
        return {}
      case 'tools/list':
        return this.paginate([...(await this.registry.get()).tools.values()].map(entry => entry.definition), 'tools', params.cursor)
      case 'resources/list':
        return this.paginate([...(await this.registry.get()).resources.values()].map(entry => entry.definition), 'resources', params.cursor)
      case 'resources/templates/list':
        return this.paginate((await this.registry.get()).resourceTemplates.map(entry => entry.definition), 'resourceTemplates', params.cursor)
      case 'prompts/list':
        return this.paginate([...(await this.registry.get()).prompts.values()].map(entry => entry.definition), 'prompts', params.cursor)
      default:
        throw new JSONRPCError(METHOD_NOT_FOUND, `Method not found: ${message.method}`)
    }
  }

  private async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined
    const protocolVersion = requested !== undefined && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION

    const registry = await this.registry.get()
    const capabilities: ServerCapabilities = {}
    if (registry.tools.size > 0) {
      capabilities.tools = { listChanged: false }
    }
    if (registry.resources.size > 0 || registry.resourceTemplates.length > 0) {
      capabilities.resources = { subscribe: false, listChanged: false }
    }
    if (registry.prompts.size > 0) {
      capabilities.prompts = { listChanged: false }
    }

    return {
      protocolVersion,
      capabilities,
      serverInfo: this.serverInfo,
      ...(this.instructions !== undefined ? { instructions: this.instructions } : {}),
    }
  }

  private checkSecurity(request: StandardLazyRequest): boolean {
    if (!this.enableDnsRebindingProtection) {
      return true
    }

    const origin = flattenStandardHeader(request.headers.origin)
    if (origin !== undefined && this.allowedOrigins !== undefined && !this.allowedOrigins.includes(origin)) {
      return false
    }

    const host = flattenStandardHeader(request.headers.host)
    if (host !== undefined && this.allowedHosts !== undefined && !this.allowedHosts.includes(host)) {
      return false
    }

    return true
  }
}

/** Opaque, offset-based pagination cursor (the registry order is deterministic). */
function encodeCursor(offset: number): string {
  return btoa(String(offset))
}

function decodeCursor(cursor: unknown): number {
  if (cursor === undefined) {
    return 0
  }
  if (typeof cursor !== 'string') {
    throw new JSONRPCError(INVALID_PARAMS, 'Invalid cursor')
  }
  let offset: number
  try {
    offset = Number(atob(cursor))
  }
  catch {
    throw new JSONRPCError(INVALID_PARAMS, 'Invalid cursor')
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new JSONRPCError(INVALID_PARAMS, 'Invalid cursor')
  }
  return offset
}

function jsonRpc(
  status: number,
  id: string | number | null,
  payload: { result: unknown } | { error: JSONRPCErrorObject },
): StandardHandlerHandleResult {
  const body = { jsonrpc: JSONRPC_VERSION, id, ...payload }
  return {
    matched: true,
    response: { status, headers: { 'content-type': 'application/json' }, body: body as unknown as StandardBody },
  }
}
