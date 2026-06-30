/**
 * Minimal MCP + JSON-RPC 2.0 wire types used by the handler.
 *
 * These describe the subset of the MCP schema this package produces/consumes.
 * They are intentionally permissive (open records) so passthrough payloads from
 * procedure handlers are not rejected.
 */

// --- JSON-RPC 2.0 ---

export type JSONRPCId = string | number

export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: JSONRPCId
  method: string
  params?: Record<string, unknown> | undefined
}

export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown> | undefined
}

export type JSONRPCIncoming = JSONRPCRequest | JSONRPCNotification

export interface JSONRPCErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JSONRPCSuccessResponse {
  jsonrpc: '2.0'
  id: JSONRPCId
  result: unknown
}

export interface JSONRPCErrorResponse {
  jsonrpc: '2.0'
  id: JSONRPCId | null
  error: JSONRPCErrorObject
}

export type JSONRPCResponse = JSONRPCSuccessResponse | JSONRPCErrorResponse

// --- MCP content ---

export interface TextContent { type: 'text', text: string, [k: string]: unknown }
export interface ImageContent { type: 'image', data: string, mimeType: string, [k: string]: unknown }
export interface AudioContent { type: 'audio', data: string, mimeType: string, [k: string]: unknown }
export interface EmbeddedResourceContent { type: 'resource', resource: ResourceContents, [k: string]: unknown }
export interface ResourceLinkContent { type: 'resource_link', uri: string, [k: string]: unknown }

export type ContentBlock
  = | TextContent
    | ImageContent
    | AudioContent
    | EmbeddedResourceContent
    | ResourceLinkContent

export interface ResourceContents {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  [k: string]: unknown
}

// --- definitions (what `*/list` returns) ---

export interface JsonSchemaObject {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [k: string]: unknown
}

export interface ToolDefinition {
  name: string
  title?: string
  description?: string
  inputSchema: JsonSchemaObject
  outputSchema?: JsonSchemaObject
  annotations?: Record<string, unknown>
}

export interface ResourceDefinition {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface ResourceTemplateDefinition {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface PromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface PromptDefinition {
  name: string
  title?: string
  description?: string
  arguments?: PromptArgument[]
}

// --- results ---

export interface CallToolResult {
  content: ContentBlock[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type PromptMessageRole = 'user' | 'assistant'

export interface PromptMessage {
  role: PromptMessageRole
  content: ContentBlock
}

export interface GetPromptResult {
  description?: string
  messages: PromptMessage[]
}

// --- lifecycle ---

export interface Implementation {
  name: string
  title?: string
  version: string
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean, listChanged?: boolean }
  prompts?: { listChanged?: boolean }
  completions?: Record<string, unknown>
  logging?: Record<string, unknown>
}

export interface InitializeResult {
  protocolVersion: string
  capabilities: ServerCapabilities
  serverInfo: Implementation
  instructions?: string
}
