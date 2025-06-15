import type { Client, ClientContext } from '@orpc/client'
import type { AnySchema, ErrorFromErrorMap, ErrorMap, InferSchemaInput, InferSchemaOutput, Meta } from '@orpc/contract'
import type { Interceptor, MaybeOptionalOptions, Promisable, PromiseWithError, Value } from '@orpc/shared'
import type { Context } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Lazyable } from './lazy'
import type { AnyProcedure, Procedure, ProcedureHandlerOptions } from './procedure'
import { ORPCError } from '@orpc/client'
import { ValidationError } from '@orpc/contract'
import { intercept, value } from '@orpc/shared'
import { mergeCurrentContext } from './context'
import { createORPCErrorConstructorMap, validateORPCError } from './error'
import { unlazy } from './lazy'
import { middlewareOutputFn } from './middleware'

export type ProcedureClient<
  TClientContext extends ClientContext,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> = Client<
  TClientContext,
  InferSchemaInput<TInputSchema>,
  InferSchemaOutput<TOutputSchema>,
  ErrorFromErrorMap<TErrorMap>
>

export interface ProcedureClientInterceptorOptions<
  TInitialContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  context: TInitialContext
  input: unknown
  errors: ORPCErrorConstructorMap<TErrorMap>
  path: readonly string[]
  procedure: Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, TMeta>
  signal?: AbortSignal
  lastEventId: string | undefined
}

export type CreateProcedureClientOptions<
  TInitialContext extends Context,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TClientContext extends ClientContext,
>
  = & {
    /**
     * This is helpful for logging and analytics.
     */
    path?: readonly string[]

    interceptors?: Interceptor<
      ProcedureClientInterceptorOptions<TInitialContext, TErrorMap, TMeta>,
      PromiseWithError<InferSchemaOutput<TOutputSchema>, ErrorFromErrorMap<TErrorMap>>
    >[]
  }
  & (
    Record<never, never> extends TInitialContext
      ? { context?: Value<Promisable<TInitialContext>, [clientContext: TClientContext]> }
      : { context: Value<Promisable<TInitialContext>, [clientContext: TClientContext]> }
  )

/**
 * Create Server-side client from a procedure.
 *
 * @see {@link https://orpc.unnoq.com/docs/client/server-side Server-side Client Docs}
 */
export function createProcedureClient<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TClientContext extends ClientContext,
>(
  lazyableProcedure: Lazyable<Procedure<TInitialContext, any, TInputSchema, TOutputSchema, TErrorMap, TMeta>>,
  ...[options]: MaybeOptionalOptions<
    CreateProcedureClientOptions<
      TInitialContext,
      TOutputSchema,
      TErrorMap,
      TMeta,
      TClientContext
    >
  >
): ProcedureClient<TClientContext, TInputSchema, TOutputSchema, TErrorMap> {
  return async (...[input, callerOptions]) => {
    const path = options?.path ?? []
    const { default: procedure } = await unlazy(lazyableProcedure)

    const clientContext = callerOptions?.context ?? {} as TClientContext // callerOptions.context can be undefined when all field is optional
    const context = await value(options?.context ?? {}, clientContext) as TInitialContext
    const errors = createORPCErrorConstructorMap(procedure['~orpc'].errorMap)

    try {
      return await intercept(
        options?.interceptors ?? [],
        {
          context,
          input: input as InferSchemaInput<TInputSchema>, // input only optional when it undefinable so we can safely cast it
          errors,
          path,
          procedure: procedure as AnyProcedure,
          signal: callerOptions?.signal,
          lastEventId: callerOptions?.lastEventId,
        },
        interceptorOptions => executeProcedureInternal(interceptorOptions.procedure, interceptorOptions),
      )
    }
    catch (e) {
      if (!(e instanceof ORPCError)) {
        throw e
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

  const next = async (index: number, context: Context, input: unknown): Promise<unknown> => {
    let currentInput = input

    if (index === inputValidationIndex) {
      currentInput = await validateInput(procedure, currentInput)
    }

    const mid = middlewares[index]

    const output = mid
      ? (await mid({
          ...options,
          context,
          next: async (...[nextOptions]) => {
            const nextContext: Context = nextOptions?.context ?? {}

            return {
              output: await next(index + 1, mergeCurrentContext(context, nextContext), currentInput),
              context: nextContext,
            }
          },
        }, currentInput, middlewareOutputFn)).output
      : await procedure['~orpc'].handler({ ...options, context, input: currentInput })

    if (index === outputValidationIndex) {
      return await validateOutput(procedure, output)
    }

    return output
  }

  return next(0, options.context, options.input)
}
