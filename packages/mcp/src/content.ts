import type { CallToolResult, ContentBlock, GetPromptResult, PromptMessage, ResourceContents } from './types'
import { stringifyJSON } from '@orpc/shared'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isContentBlock(value: unknown): value is ContentBlock {
  return isPlainRecord(value) && typeof value.type === 'string'
}

/**
 * Encode a tool handler's return value into an MCP `tools/call` result.
 *
 * - Pre-formed content blocks (or arrays of them) pass through unchanged.
 * - `string` → a single text block.
 * - `undefined`/`null` → empty content.
 * - plain objects → a JSON text block, plus `structuredContent`
 *   when the tool declares an `outputSchema`.
 * - other values (numbers, arrays, …) → a JSON text block.
 */
export function encodeToolResult(output: unknown, hasOutputSchema: boolean): CallToolResult {
  if (Array.isArray(output) && output.length > 0 && output.every(isContentBlock)) {
    return { content: output }
  }

  if (isContentBlock(output)) {
    return { content: [output] }
  }

  if (typeof output === 'string') {
    return { content: [{ type: 'text', text: output }] }
  }

  if (output === undefined || output === null) {
    return { content: [] }
  }

  const text = stringifyJSON(output)
  const result: CallToolResult = { content: [{ type: 'text', text }] }

  if (hasOutputSchema && isPlainRecord(output)) {
    result.structuredContent = output
  }

  return result
}

/**
 * Encode a resource handler's return value into MCP `resources/read` contents.
 * Strings are returned as text; everything else is JSON-serialized.
 */
export function encodeResourceContents(output: unknown, uri: string, mimeType?: string): ResourceContents[] {
  if (isContentBlock(output) && output.type === 'resource' && isPlainRecord(output.resource)) {
    return [output.resource as ResourceContents]
  }

  if (typeof output === 'string') {
    return [{ uri, mimeType: mimeType ?? 'text/plain', text: output }]
  }

  return [{ uri, mimeType: mimeType ?? 'application/json', text: stringifyJSON(output) ?? 'null' }]
}

/**
 * Encode a prompt handler's return value into an MCP `prompts/get` result.
 *
 * - `string` → a single `user` message.
 * - `{ messages, description? }` → passed through (the expected typed shape).
 */
export function encodePromptMessages(output: unknown): GetPromptResult {
  if (typeof output === 'string') {
    return { messages: [{ role: 'user', content: { type: 'text', text: output } }] }
  }

  if (isPlainRecord(output) && Array.isArray(output.messages)) {
    const messages = output.messages as PromptMessage[]
    return typeof output.description === 'string'
      ? { description: output.description, messages }
      : { messages }
  }

  throw new TypeError(
    'An MCP prompt handler must return a string or an object with a `messages` array',
  )
}
