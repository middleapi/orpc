import type { ClientOptions, ClientPromiseResult } from '@orpc/client'
import type { AnyContractProcedure, AnySchema, ErrorFromErrorMap, ErrorMap, InferSchemaInput, InferSchemaOutput, Meta } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Context } from './context'
import type { Lazy, Lazyable } from './lazy'
import type { AnyProcedure } from './procedure'
import type { CreateProcedureClientOptions } from './procedure-client'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { getLazyMeta, lazy, unlazy } from './lazy'
import { isProcedure, Procedure } from './procedure'
import { createProcedureClient } from './procedure-client'

export function createAssertedLazyProcedure(lazied: Lazy<any>): Lazy<AnyProcedure> {
  const lazyProcedure = lazy(async () => {
    const { default: maybeProcedure } = await unlazy(lazied)

    if (!isProcedure(maybeProcedure)) {
      throw new Error(`
            Expected a lazy<procedure> but got lazy<unknown>.
            This should be caught by TypeScript compilation.
            Please report this issue if this makes you feel uncomfortable.
        `)
    }

    return { default: maybeProcedure }
  }, getLazyMeta(lazied))

  return lazyProcedure
}

/**
 * Create a new procedure that ensure the contract is applied to the procedure.
 */
export function createContractedProcedure(procedure: AnyProcedure, contract: AnyContractProcedure): AnyProcedure {
  return new Procedure({
    ...procedure['~orpc'],
    errorMap: contract['~orpc'].errorMap,
    route: contract['~orpc'].route,
    meta: contract['~orpc'].meta,
  })
}

/**
 * Directly call a procedure without creating a client.
 *
 * @example
 * ```ts
 * const output = await call(getting, 'input')
 * const output = await call(getting, 'input', { context: { db: 'postgres' } })
 * ```
 *
 */
export function call<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
>(
  procedure: Lazyable<Procedure<TInitialContext, any, TInputSchema, TOutputSchema, TErrorMap, TMeta>>,
  input: InferSchemaInput<TInputSchema>,
  ...rest: MaybeOptionalOptions<
    CreateProcedureClientOptions<
      TInitialContext,
      TOutputSchema,
      TErrorMap,
      TMeta,
      Record<never, never>
    > & Omit<ClientOptions<Record<never, never>>, 'context'>
  >
): ClientPromiseResult<InferSchemaOutput<TOutputSchema>, ErrorFromErrorMap<TErrorMap>> {
  const options = resolveMaybeOptionalOptions(rest)
  return createProcedureClient(procedure, options)(input, options)
}
