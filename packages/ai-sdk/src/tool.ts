import type { ClientOptions } from '@orpc/client'
import type { AnySchema, ContractProcedure, ErrorMap, InferSchemaInput, InferSchemaOutput, Meta, Schema } from '@orpc/contract'
import type { Context, CreateProcedureClientOptions } from '@orpc/server'
import type { MaybeOptionalOptions, SetOptional } from '@orpc/shared'
import type { Tool } from 'ai'
import { call, Procedure } from '@orpc/server'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { tool } from 'ai'

export const AI_SDK_TOOL_META_SYMBOL: unique symbol = Symbol('ORPC_AI_SDK_TOOL_META')

export interface AiSdkToolMeta extends Meta {
  [AI_SDK_TOOL_META_SYMBOL]?: Partial<Tool<unknown, unknown>>
}

export class CreateToolError extends Error {}

/**
 * Implements [procedure contract](https://orpc.unnoq.com/docs/contract-first/define-contract#procedure-contract)
 * as an [AI SDK Tool](https://ai-sdk.dev/docs/foundations/tools) by leveraging existing contract definitions.
 *
 * @warning Requires a contract with an `input` schema defined.
 * @info Standard [procedures](https://orpc.unnoq.com/docs/procedure) are also compatible with [procedure contracts](https://orpc.unnoq.com/docs/contract-first/define-contract).
 *
 * @example
 * ```ts
 * import { oc } from '@orpc/contract'
 * import {
 *   AI_SDK_TOOL_META_SYMBOL,
 *   AiSdkToolMeta,
 *   implementTool,
 * } from '@orpc/ai-sdk'
 * import { z } from 'zod'
 *
 * interface ORPCMeta extends AiSdkToolMeta {} // optional extend meta
 * const base = oc.$meta<ORPCMeta>({})
 *
 * const getWeatherContract = base
 *   .meta({
 *     [AI_SDK_TOOL_META_SYMBOL]: {
 *       name: 'custom-tool-name', // AI SDK tool name
 *     },
 *   })
 *   .route({
 *     summary: 'Get the weather in a location', // AI SDK tool description
 *   })
 *   .input(
 *     z.object({
 *       location: z.string().describe('The location to get the weather for'),
 *     }),
 *   )
 *   .output(
 *     z.object({
 *       location: z.string().describe('The location the weather is for'),
 *       temperature: z.number().describe('The temperature in Celsius'),
 *     }),
 *   )
 *
 * const getWeatherTool = implementTool(getWeatherContract, {
 *   execute: async ({ location }) => ({
 *     location,
 *     temperature: 72 + Math.floor(Math.random() * 21) - 10,
 *   }),
 * })
 * ```
 */
export function implementTool<TOutInput, TInOutput>(
  contract: ContractProcedure<Schema<any, TOutInput>, Schema<TInOutput, any>, any, AiSdkToolMeta>,
  ...rest: MaybeOptionalOptions<SetOptional<Tool<TOutInput, TInOutput>, 'inputSchema' | 'outputSchema'>>
): Tool<TOutInput, TInOutput> {
  if (contract['~orpc'].inputSchema === undefined) {
    throw new CreateToolError('Cannot implement tool from a contract procedure without input schema.')
  }

  const options = resolveMaybeOptionalOptions(rest)

  return tool<TOutInput, TInOutput>({
    inputSchema: contract['~orpc'].inputSchema,
    outputSchema: contract['~orpc'].outputSchema,
    description: contract['~orpc'].route.summary ?? contract['~orpc'].route.description,
    ...contract['~orpc'].meta[AI_SDK_TOOL_META_SYMBOL],
    ...options,
  } as any)
}

/**
 * Converts a [procedure](https://orpc.unnoq.com/docs/procedure) into an [AI SDK Tool](https://ai-sdk.dev/docs/foundations/tools)
 * by leveraging existing procedure definitions.
 *
 * @warning Requires a contract with an `input` schema defined.
 *
 * @example
 * ```ts
 * import { os } from '@orpc/server'
 * import {
 *   AI_SDK_TOOL_META_SYMBOL,
 *   AiSdkToolMeta,
 *   createTool
 * } from '@orpc/ai-sdk'
 * import { z } from 'zod'
 *
 * interface ORPCMeta extends AiSdkToolMeta {} // optional extend meta
 * const base = os.$meta<ORPCMeta>({})
 *
 * const getWeatherProcedure = base
 *   .meta({
 *     [AI_SDK_TOOL_META_SYMBOL]: {
 *       name: 'custom-tool-name', // AI SDK tool name
 *     },
 *   })
 *   .route({
 *     summary: 'Get the weather in a location',
 *   })
 *   .input(z.object({
 *     location: z.string().describe('The location to get the weather for'),
 *   }))
 *   .output(z.object({
 *     location: z.string().describe('The location the weather is for'),
 *     temperature: z.number().describe('The temperature in Celsius'),
 *   }))
 *   .handler(async ({ input }) => ({
 *     location: input.location,
 *     temperature: 72 + Math.floor(Math.random() * 21) - 10,
 *   }))
 *
 * const getWeatherTool = createTool(getWeatherProcedure, {
 *   context: {}, // provide initial context if needed
 * })
 * ```
 */
export function createTool<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends AiSdkToolMeta,
>(
  procedure: Procedure<TInitialContext, any, TInputSchema, TOutputSchema, TErrorMap, TMeta>,
  ...rest: MaybeOptionalOptions<
    & SetOptional<Tool<InferSchemaOutput<TInputSchema>, InferSchemaInput<TOutputSchema>>, 'inputSchema' | 'outputSchema' | 'execute'>
    & CreateProcedureClientOptions<TInitialContext, TOutputSchema, TErrorMap, TMeta, Record<never, never>>
    & Omit<ClientOptions<Record<never, never>>, 'context'>
  >
): Tool<InferSchemaOutput<TInputSchema>, InferSchemaInput<TOutputSchema>> {
  const options = resolveMaybeOptionalOptions(rest)

  return implementTool(procedure, {
    execute: ((input, callingOptions) => {
      const disabledValidation = new Procedure({
        ...procedure['~orpc'],
        inputValidationIndex: Number.NaN, // disable input validation
        outputValidationIndex: Number.NaN, // disable output validation
      })

      return call(
        disabledValidation,
        input as InferSchemaInput<TInputSchema>,
        { signal: callingOptions.abortSignal, ...options },
      ) as Promise<InferSchemaInput<TOutputSchema>>
    }) satisfies (Tool<InferSchemaOutput<TInputSchema>, InferSchemaInput<TOutputSchema>>['execute']),
    ...options,
  } as any)
}
