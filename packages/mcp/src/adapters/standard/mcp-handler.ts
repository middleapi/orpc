import type { JsonSchemaConverter } from '@orpc/json-schema'
import type { AnyRouter, Context } from '@orpc/server'
import type { MCPRegistry } from '../../registry'
import type {
  Implementation,
  InitializeResult,
  JSONRPCIncoming,
  JSONRPCResponse,
  ServerCapabilities,
} from '../../types'
import { ORPCError } from '@orpc/client'
import { call } from '@orpc/server'
import {
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_VERSION,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  RESOURCE_NOT_FOUND,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../../constants'
import { encodePromptMessages, encodeResourceContents, encodeToolResult } from '../../content'
import { JSONRPCError, orpcErrorToJSONRPCError } from '../../error'
import { buildMCPRegistry } from '../../registry'

export interface StandardMCPHandlerOptions {
  /** Server identity reported during `initialize`. */
  serverInfo?: Partial<Implementation>
  /** Schema → JSON Schema converters (e.g. `new ZodToJsonSchemaConverter()`). */
  converters?: JsonSchemaConverter[]
  /** Optional `instructions` returned to the client during `initialize`. */
  instructions?: string
}

export interface MCPDispatchOptions<T extends Context> {
  context: T
  signal?: AbortSignal
}

export interface MCPHandlePayloadResult {
  responses: JSONRPCResponse[]
  isBatch: boolean
}

/**
 * Transport-agnostic MCP dispatcher. Walks the router once (lazily, on first
 * use), then maps incoming JSON-RPC methods to oRPC procedure calls.
 */
export class StandardMCPHandler<T extends Context> {
  private registryPromise: Promise<MCPRegistry> | undefined
  private readonly serverInfo: Implementation

  constructor(
    private readonly router: AnyRouter,
    private readonly options: StandardMCPHandlerOptions = {},
  ) {
    this.serverInfo = {
      name: options.serverInfo?.name ?? DEFAULT_SERVER_NAME,
      version: options.serverInfo?.version ?? DEFAULT_SERVER_VERSION,
      ...(options.serverInfo?.title !== undefined ? { title: options.serverInfo.title } : {}),
    }
  }

  private registry(): Promise<MCPRegistry> {
    this.registryPromise ??= buildMCPRegistry(this.router, { converters: this.options.converters })
    return this.registryPromise
  }

  /** Handle a single JSON-RPC message. Returns `undefined` for notifications. */
  async handle(message: JSONRPCIncoming, options: MCPDispatchOptions<T>): Promise<JSONRPCResponse | undefined> {
    const id = 'id' in message ? message.id : undefined

    try {
      const result = await this.dispatch(message.method, message.params ?? {}, options)
      return id === undefined ? undefined : { jsonrpc: JSONRPC_VERSION, id, result }
    }
    catch (error) {
      if (id === undefined) {
        return undefined
      }
      const jsonRpcError = error instanceof JSONRPCError
        ? error
        : new JSONRPCError(INTERNAL_ERROR, error instanceof Error ? error.message : 'Internal error')
      return { jsonrpc: JSONRPC_VERSION, id, error: jsonRpcError.toJSON() }
    }
  }

  /** Parse a single message or a JSON-RPC batch and dispatch all of them. */
  async handlePayload(payload: unknown, options: MCPDispatchOptions<T>): Promise<MCPHandlePayloadResult> {
    const isBatch = Array.isArray(payload)
    const messages: unknown[] = isBatch ? (payload as unknown[]) : [payload]
    const responses: JSONRPCResponse[] = []

    for (const message of messages) {
      if (!isValidIncoming(message)) {
        responses.push({
          jsonrpc: JSONRPC_VERSION,
          id: isObject(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null,
          error: { code: INVALID_REQUEST, message: 'Invalid Request' },
        })
        continue
      }
      const response = await this.handle(message, options)
      if (response !== undefined) {
        responses.push(response)
      }
    }

    return { responses, isBatch }
  }

  private async dispatch(method: string, params: Record<string, unknown>, options: MCPDispatchOptions<T>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params)
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined
      case 'ping':
        return {}
      case 'tools/list':
        return this.listTools()
      case 'tools/call':
        return this.callTool(params, options)
      case 'resources/list':
        return this.listResources()
      case 'resources/templates/list':
        return this.listResourceTemplates()
      case 'resources/read':
        return this.readResource(params, options)
      case 'prompts/list':
        return this.listPrompts()
      case 'prompts/get':
        return this.getPrompt(params, options)
      case 'completion/complete':
        return { completion: { values: [], total: 0, hasMore: false } }
      default:
        throw new JSONRPCError(METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  }

  private async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined
    const protocolVersion = requested !== undefined && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION

    const registry = await this.registry()
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
      ...(this.options.instructions !== undefined ? { instructions: this.options.instructions } : {}),
    }
  }

  private async listTools(): Promise<{ tools: unknown[] }> {
    const registry = await this.registry()
    return { tools: [...registry.tools.values()].map(entry => entry.definition) }
  }

  private async callTool(params: Record<string, unknown>, options: MCPDispatchOptions<T>): Promise<unknown> {
    const registry = await this.registry()
    const name = params.name
    const entry = typeof name === 'string' ? registry.tools.get(name) : undefined
    if (entry === undefined) {
      throw new JSONRPCError(INVALID_PARAMS, `Unknown tool: ${String(name)}`)
    }

    const args = isObject(params.arguments) ? params.arguments : {}
    try {
      const output = await call(entry.procedure, args, {
        context: options.context,
        signal: options.signal,
        path: [entry.definition.name],
      })
      return encodeToolResult(output, entry.definition.outputSchema !== undefined)
    }
    catch (error) {
      if (error instanceof ORPCError) {
        // Report as an in-band tool error so the model can react. We deliberately
        // do NOT set `structuredContent` here: MCP clients validate it against the
        // tool's `outputSchema` (the success shape), which an error would violate.
        return {
          content: [{ type: 'text', text: error.message }],
          isError: true,
        }
      }
      throw error
    }
  }

  private async listResources(): Promise<{ resources: unknown[] }> {
    const registry = await this.registry()
    return { resources: [...registry.resources.values()].map(entry => entry.definition) }
  }

  private async listResourceTemplates(): Promise<{ resourceTemplates: unknown[] }> {
    const registry = await this.registry()
    return { resourceTemplates: registry.resourceTemplates.map(entry => entry.definition) }
  }

  private async readResource(params: Record<string, unknown>, options: MCPDispatchOptions<T>): Promise<unknown> {
    const registry = await this.registry()
    const uri = params.uri
    if (typeof uri !== 'string') {
      throw new JSONRPCError(INVALID_PARAMS, 'resources/read requires a string "uri"')
    }

    const staticEntry = registry.resources.get(uri)
    if (staticEntry !== undefined) {
      try {
        const output = await call(staticEntry.procedure, {}, { context: options.context, signal: options.signal })
        return { contents: encodeResourceContents(output, uri, staticEntry.meta.mimeType) }
      }
      catch (error) {
        throw orpcErrorToJSONRPCError(error)
      }
    }

    for (const entry of registry.resourceTemplates) {
      const variables = entry.template.match(uri)
      if (variables !== undefined) {
        try {
          const output = await call(entry.procedure, variables, { context: options.context, signal: options.signal })
          return { contents: encodeResourceContents(output, uri, entry.meta.mimeType) }
        }
        catch (error) {
          throw orpcErrorToJSONRPCError(error)
        }
      }
    }

    throw new JSONRPCError(RESOURCE_NOT_FOUND, `Resource not found: ${uri}`, { uri })
  }

  private async listPrompts(): Promise<{ prompts: unknown[] }> {
    const registry = await this.registry()
    return { prompts: [...registry.prompts.values()].map(entry => entry.definition) }
  }

  private async getPrompt(params: Record<string, unknown>, options: MCPDispatchOptions<T>): Promise<unknown> {
    const registry = await this.registry()
    const name = params.name
    const entry = typeof name === 'string' ? registry.prompts.get(name) : undefined
    if (entry === undefined) {
      throw new JSONRPCError(INVALID_PARAMS, `Unknown prompt: ${String(name)}`)
    }

    const args = isObject(params.arguments) ? params.arguments : {}
    try {
      const output = await call(entry.procedure, args, { context: options.context, signal: options.signal })
      const result = encodePromptMessages(output)
      return entry.meta.description !== undefined && result.description === undefined
        ? { description: entry.meta.description, ...result }
        : result
    }
    catch (error) {
      throw orpcErrorToJSONRPCError(error)
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidIncoming(value: unknown): value is JSONRPCIncoming {
  return isObject(value) && value.jsonrpc === JSONRPC_VERSION && typeof value.method === 'string'
}
