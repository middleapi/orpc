import type { AnyORPCError } from '@orpc/client'
import type { AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput } from '@orpc/contract'
import type { Promisable, Value } from '@orpc/shared'
import type { Context } from '../context'
import type { Lazyable } from '../lazy'
import type { Procedure } from '../procedure'
import { value } from '@orpc/shared'
import { createProcedureClient } from '../procedure-client'

export type TestContextOption<TInitialContext extends Context = Context> = Value<Promisable<Partial<TInitialContext>>>

export interface TestCallerOptions<TInitialContext extends Context> {
  context?: TestContextOption<TInitialContext>
}

export interface TestInvocationOptions<TInitialContext extends Context> {
  context?: Partial<TInitialContext>
}

let globalTestContext: TestContextOption<Context> | undefined

/**
 * Configure global/suite-wide test context defaults.
 */
export function configureTestCaller(options: { context?: TestContextOption<Context> }): void {
  globalTestContext = options.context
}

/**
 * Create a typed test procedure caller supporting static context, dynamic context factories,
 * per-call context overrides, and suite-wide context defaults.
 */
export function createTestCaller<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedError extends AnyORPCError,
>(
  procedure: Lazyable<Procedure<TInitialContext, any, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>>,
  callerOptions?: TestCallerOptions<TInitialContext>,
) {
  return async (
    input: InferSchemaInput<TInputSchema>,
    invocationOptions?: TestInvocationOptions<TInitialContext>,
  ): Promise<InferSchemaOutput<TOutputSchema>> => {
    const globalCtx = globalTestContext ? await value(globalTestContext) : undefined
    const callerCtx = callerOptions?.context ? await value(callerOptions.context) : undefined

    const finalContext = Object.assign(
      {},
      globalCtx,
      callerCtx,
      invocationOptions?.context,
    ) as TInitialContext

    const client = createProcedureClient(procedure, {
      context: finalContext,
    })

    return await client(input)
  }
}
