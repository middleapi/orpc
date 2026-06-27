/** The MCP protocol revision this package targets by default. */
export const LATEST_PROTOCOL_VERSION = '2025-11-25'

/** Protocol revisions this server can negotiate, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const

export const JSONRPC_VERSION = '2.0'

/** Default server identity when none is provided to the handler. */
export const DEFAULT_SERVER_NAME = 'orpc-mcp-server'
export const DEFAULT_SERVER_VERSION = '1.0.0'

// --- JSON-RPC 2.0 + MCP error codes ---
export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603
/** MCP-specific: resource (or prompt) not found. */
export const RESOURCE_NOT_FOUND = -32002
