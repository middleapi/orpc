import type { Promisable } from '@orpc/shared'
import type { Lazy } from './lazy'
import type { Middleware } from './middleware'
import type { Context, MergeContext, Meta } from './types'
import { type ContractProcedure, isContractProcedure, type Schema, type SchemaInput, type SchemaOutput } from '@orpc/contract'

export interface ProcedureFunc<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
> {
  (
    input: SchemaOutput<TInputSchema>,
    context: MergeContext<TContext, TExtraContext>,
    meta: Meta,
  ): Promisable<SchemaInput<TOutputSchema, THandlerOutput>>
}

export interface ProcedureDef<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
> {
  middlewares?: Middleware<MergeContext<TContext, TExtraContext>, Partial<TExtraContext> | undefined, SchemaOutput<TInputSchema>, any>[]
  contract: ContractProcedure<TInputSchema, TOutputSchema>
  handler: ProcedureFunc<TContext, TExtraContext, TInputSchema, TOutputSchema, THandlerOutput>
}

export class Procedure<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
> {
  '~type' = 'Procedure' as const
  '~orpc': ProcedureDef<TContext, TExtraContext, TInputSchema, TOutputSchema, THandlerOutput>

  constructor(def: ProcedureDef<TContext, TExtraContext, TInputSchema, TOutputSchema, THandlerOutput>) {
    this['~orpc'] = def
  }
}

export type ANY_PROCEDURE = Procedure<any, any, any, any, any>
export type WELL_PROCEDURE = Procedure<Context, Context, Schema, Schema, unknown>
export type ANY_LAZY_PROCEDURE = Lazy<ANY_PROCEDURE>

export function isProcedure(item: unknown): item is ANY_PROCEDURE {
  if (item instanceof Procedure) {
    return true
  }

  return (
    (typeof item === 'object' || typeof item === 'function')
    && item !== null
    && '~type' in item
    && item['~type'] === 'Procedure'
    && '~orpc' in item
    && typeof item['~orpc'] === 'object'
    && item['~orpc'] !== null
    && 'contract' in item['~orpc']
    && isContractProcedure(item['~orpc'].contract)
    && 'handler' in item['~orpc']
    && typeof item['~orpc'].handler === 'function'
  )
}
