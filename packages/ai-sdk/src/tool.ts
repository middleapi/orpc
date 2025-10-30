import type { ContractProcedure, Meta, Schema } from '@orpc/contract'
import type { SetOptional } from '@orpc/shared'
import type { Tool } from 'ai'
import { tool } from 'ai'

export const CREATE_AI_SDK_TOOL_META_SYMBOL: unique symbol = Symbol('ORPC_CREATE_AI_SDK_TOOL_META')

export interface CreateAiSdkToolMeta extends Meta {
  [CREATE_AI_SDK_TOOL_META_SYMBOL]?: Partial<Tool<unknown, unknown>>
}

export class CreateToolError extends Error {}

export function createTool<TInput, TOutput>(
  contract: ContractProcedure<Schema<any, TInput>, Schema<any, TOutput>, any, CreateAiSdkToolMeta>,
  options: SetOptional<Tool<TInput, TOutput>, 'inputSchema' | 'outputSchema'>,
): Tool<TInput, TOutput> {
  if (contract['~orpc'].inputSchema === undefined) {
    throw new CreateToolError('Cannot create tool from a contract procedure without input schema.')
  }

  return tool({
    inputSchema: contract['~orpc'].inputSchema,
    outputSchema: contract['~orpc'].outputSchema,
    description: contract['~orpc'].route.summary ?? contract['~orpc'].route.description,
    ...contract['~orpc'].meta[CREATE_AI_SDK_TOOL_META_SYMBOL],
    ...options,
  } as any)
}
