import type { ContractProcedure, Schema, SchemaInput, SchemaOutput } from '@orpc/contract'
import type { ANY_MAP_INPUT_MIDDLEWARE, ANY_MIDDLEWARE, MapInputMiddleware, Middleware } from './middleware'
import type { ProcedureFunc } from './procedure'
import type { DecoratedProcedure } from './procedure-decorated'
import type { Context, MergeContext } from './types'
import { decorateMiddleware } from './middleware-decorated'
import { Procedure } from './procedure'
import { decorateProcedure } from './procedure-decorated'

export type ProcedureImplementerDef<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
> = {
  contract: ContractProcedure<TInputSchema, TOutputSchema>
  middlewares?: Middleware<MergeContext<TContext, TExtraContext>, Partial<TExtraContext> | undefined, SchemaOutput<TInputSchema>, SchemaInput<TOutputSchema>>[]
}

export class ProcedureImplementer<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
> {
  '~type' = 'ProcedureImplementer' as const
  '~orpc': ProcedureImplementerDef<TContext, TExtraContext, TInputSchema, TOutputSchema>

  constructor(def: ProcedureImplementerDef<TContext, TExtraContext, TInputSchema, TOutputSchema>) {
    this['~orpc'] = def
  }

  use<U extends Context & Partial<MergeContext<TContext, TExtraContext>> | undefined = undefined>(
    middleware: Middleware<
      MergeContext<TContext, TExtraContext>,
      U,
      SchemaOutput<TInputSchema>,
      SchemaInput<TOutputSchema>
    >,
  ): ProcedureImplementer<
    TContext,
    MergeContext<TExtraContext, U>,
    TInputSchema,
    TOutputSchema
  >

  use<
    UExtra extends Context & Partial<MergeContext<TContext, TExtraContext>> | undefined = undefined,
    UInput = unknown,
  >(
    middleware: Middleware<
      MergeContext<TContext, TExtraContext>,
      UExtra,
      UInput,
      SchemaInput<TOutputSchema>
    >,
    mapInput: MapInputMiddleware<SchemaOutput<TInputSchema>, UInput>,
  ): ProcedureImplementer<
    TContext,
    MergeContext<TExtraContext, UExtra>,
    TInputSchema,
    TOutputSchema
  >

  use(
    middleware: ANY_MIDDLEWARE,
    mapInput?: ANY_MAP_INPUT_MIDDLEWARE,
  ): ProcedureImplementer<any, any, any, any> {
    const mappedMiddleware = mapInput
      ? decorateMiddleware(middleware).mapInput(mapInput)
      : middleware

    return new ProcedureImplementer({
      ...this['~orpc'],
      middlewares: [...(this['~orpc'].middlewares ?? []), mappedMiddleware],
    })
  }

  handler<UFuncOutput extends SchemaInput<TOutputSchema>>(
    handler: ProcedureFunc<TContext, TExtraContext, TInputSchema, TOutputSchema, UFuncOutput>,
  ): DecoratedProcedure<TContext, TExtraContext, TInputSchema, TOutputSchema, UFuncOutput > {
    return decorateProcedure(new Procedure({
      middlewares: this['~orpc'].middlewares,
      contract: this['~orpc'].contract,
      handler,
    }))
  }
}
