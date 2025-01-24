import type { Client, ErrorFromErrorMap, ErrorMap, Schema, SchemaInput, SchemaOutput } from '@orpc/contract'
import type { Hooks, Value } from '@orpc/shared'
import type { Context } from './context'
import type { Lazyable } from './lazy'
import type { MiddlewareNextFn } from './middleware'
import type { AnyProcedure, Procedure, ProcedureHandlerOptions } from './procedure'
import { createORPCErrorConstructorMap, ORPCError, validateORPCError, ValidationError } from '@orpc/contract'
import { executeWithHooks, toError, value } from '@orpc/shared'
import { unlazy } from './lazy'
import { middlewareOutputFn } from './middleware'

export type ProcedureClient<
  TClientContext,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
  TErrorMap extends ErrorMap,
> = Client<TClientContext, SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema, THandlerOutput>, ErrorFromErrorMap<TErrorMap>>

/**
 * Options for creating a procedure caller with comprehensive type safety
 */
export type CreateProcedureClientOptions<
  TInitialContext extends Context,
  TCurrentContext extends Schema,
  THandlerOutput extends SchemaInput<TCurrentContext>,
  TClientContext,
> =
  & {
    /**
     * This is helpful for logging and analytics.
     */
    path?: string[]
  }
  & (
    | { context: Value<TInitialContext, [clientContext: TClientContext]> }
    | (Record<never, never> extends TInitialContext ? Record<never, never> : never)
  )
  & Hooks<unknown, SchemaOutput<TCurrentContext, THandlerOutput>, TInitialContext, any>

export type CreateProcedureClientRest<
  TInitialContext extends Context,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
  TClientContext,
> =
  | [options: CreateProcedureClientOptions<TInitialContext, TOutputSchema, THandlerOutput, TClientContext>]
  | (Record<never, never> extends TInitialContext ? [] : never)

export function createProcedureClient<
  TInitialContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
  TErrorMap extends ErrorMap,
  TClientContext,
>(
  lazyableProcedure: Lazyable<Procedure<TInitialContext, any, TInputSchema, TOutputSchema, THandlerOutput, TErrorMap, any>>,
  ...[options]: CreateProcedureClientRest<TInitialContext, TOutputSchema, THandlerOutput, TClientContext>
): ProcedureClient<TClientContext, TInputSchema, TOutputSchema, THandlerOutput, TErrorMap> {
  return async (...[input, callerOptions]) => {
    const path = options?.path ?? []
    const { default: procedure } = await unlazy(lazyableProcedure)

    const context = await value(options?.context ?? {}, callerOptions?.context) as TInitialContext
    const errors = createORPCErrorConstructorMap(procedure['~orpc'].errorMap)

    const executeOptions = {
      input,
      context,
      errors,
      path,
      procedure: procedure as AnyProcedure,
      signal: callerOptions?.signal,
    }

    try {
      const output = await executeWithHooks({
        hooks: options,
        input,
        context,
        meta: executeOptions,
        execute: () => executeProcedureInternal(procedure, executeOptions),
      })

      return output
    }
    catch (e) {
      if (!(e instanceof ORPCError)) {
        throw toError(e)
      }

      const validated = await validateORPCError(procedure['~orpc'].errorMap, e)

      throw validated
    }
  }
}

async function validateInput(procedure: AnyProcedure, input: unknown): Promise<any> {
  const schema = procedure['~orpc'].inputSchema

  if (!schema) {
    return input
  }

  const result = await schema['~standard'].validate(input)
  if (result.issues) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Input validation failed',
      data: {
        issues: result.issues,
      },
      cause: new ValidationError({ message: 'Input validation failed', issues: result.issues }),
    })
  }

  return result.value
}

async function validateOutput(procedure: AnyProcedure, output: unknown): Promise<any> {
  const schema = procedure['~orpc'].outputSchema

  if (!schema) {
    return output
  }

  const result = await schema['~standard'].validate(output)
  if (result.issues) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Output validation failed',
      cause: new ValidationError({ message: 'Output validation failed', issues: result.issues }),
    })
  }

  return result.value
}

async function executeProcedureInternal(procedure: AnyProcedure, options: ProcedureHandlerOptions<any, any, any, any>): Promise<any> {
  const middlewares = procedure['~orpc'].middlewares
  const inputValidationIndex = Math.min(Math.max(0, procedure['~orpc'].inputValidationIndex), middlewares.length)
  const outputValidationIndex = Math.min(Math.max(0, procedure['~orpc'].outputValidationIndex), middlewares.length)
  let currentIndex = 0
  let currentContext = options.context
  let currentInput = options.input

  const next: MiddlewareNextFn<any, any> = async (...[nextOptions]) => {
    const index = currentIndex
    currentIndex += 1
    currentContext = { ...currentContext, ...nextOptions?.context }

    if (index === inputValidationIndex) {
      currentInput = await validateInput(procedure, currentInput)
    }

    const mid = middlewares[index]

    const result = mid
      ? await mid({ ...options, context: currentContext, next }, currentInput, middlewareOutputFn)
      : { output: await procedure['~orpc'].handler({ ...options, context: currentContext, input: currentInput }), context: currentContext }

    if (index === outputValidationIndex) {
      const validatedOutput = await validateOutput(procedure, result.output)

      return {
        ...result,
        output: validatedOutput,
      }
    }

    return result
  }

  return (await next({})).output
}
