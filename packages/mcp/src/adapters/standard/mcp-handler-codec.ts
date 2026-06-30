import type { AnyORPCError } from '@orpc/client'
import type { AnyProcedure, Context } from '@orpc/server'
import type { StandardHandlerCodec, StandardHandlerCodecResolvedProcedure, StandardHandlerHandleOptions } from '@orpc/server/standard'
import type { Promisable } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@standardserver/core'
import type { MCPRegistryProvider } from '../../registry'
import { isObject, isValidIncoming, readMCPPayload } from './utils'

/**
 * Internal `StandardResponse.body` produced by the codec. The
 * {@link MCPHandlerPlugin} reads it back to shape the MCP result and frame the
 * JSON-RPC envelope (it owns the request `id`); this body never reaches the wire.
 */
export interface MCPCodecBody {
  kind: 'result' | 'error'
  output?: unknown
  error?: AnyORPCError
}

/**
 * `StandardHandlerCodec` for the MCP methods that invoke a procedure
 * (`tools/call`, `resources/read`, `prompts/get`). It resolves the target
 * procedure from the JSON-RPC body and hands the raw output/error back to the
 * plugin (tagged via {@link MCP_CODEC_BODY}) — the plugin shapes the MCP result
 * and frames the JSON-RPC envelope. Everything else (the actual call) goes
 * through oRPC's standard procedure pipeline.
 */
export class MCPHandlerCodec<T extends Context> implements StandardHandlerCodec<T> {
  constructor(private readonly registry: MCPRegistryProvider) {}

  async resolveProcedure(
    request: StandardLazyRequest,
    _options: StandardHandlerHandleOptions<T>,
  ): Promise<StandardHandlerCodecResolvedProcedure | undefined> {
    const message = await readMCPPayload(request)
    if (!isValidIncoming(message) || !('id' in message) || message.id === undefined) {
      return undefined
    }

    const params = isObject(message.params) ? message.params : {}
    const registry = await this.registry.get()

    if (message.method === 'tools/call') {
      const entry = typeof params.name === 'string' ? registry.tools.get(params.name) : undefined
      if (entry === undefined) {
        return undefined
      }
      const input = isObject(params.arguments) ? params.arguments : {}
      return { path: [entry.definition.name], procedure: entry.procedure, decodeInput: () => Promise.resolve(input) }
    }

    if (message.method === 'resources/read') {
      if (typeof params.uri !== 'string') {
        return undefined
      }
      const staticEntry = registry.resources.get(params.uri)
      if (staticEntry !== undefined) {
        return { path: [staticEntry.definition.name], procedure: staticEntry.procedure, decodeInput: () => Promise.resolve({}) }
      }
      for (const entry of registry.resourceTemplates) {
        const variables = entry.template.match(params.uri)
        if (variables !== undefined) {
          return { path: [entry.definition.name], procedure: entry.procedure, decodeInput: () => Promise.resolve(variables) }
        }
      }
      return undefined
    }

    if (message.method === 'prompts/get') {
      const entry = typeof params.name === 'string' ? registry.prompts.get(params.name) : undefined
      if (entry === undefined) {
        return undefined
      }
      const input = isObject(params.arguments) ? params.arguments : {}
      return { path: [entry.definition.name], procedure: entry.procedure, decodeInput: () => Promise.resolve(input) }
    }

    return undefined
  }

  encodeOutput(output: unknown, _procedure: AnyProcedure, _path: string[], _options: StandardHandlerHandleOptions<T>): Promisable<StandardResponse> {
    return { status: 200, headers: {}, body: { kind: 'result', output } satisfies MCPCodecBody as never }
  }

  encodeError(error: AnyORPCError, _procedure: AnyProcedure, _path: string[], _options: StandardHandlerHandleOptions<T>): Promisable<StandardResponse> {
    return { status: 200, headers: {}, body: { kind: 'error', error } satisfies MCPCodecBody as never }
  }
}
