import type { MapInputMiddleware, Middleware } from './middleware'
import type { DecoratedProcedure } from './procedure-decorated'
import type { Context, MergeContext } from './types'
import {
  type ContractProcedure,
  DecoratedContractProcedure,
  type RouteOptions,
  type Schema,
  type SchemaInput,
  type SchemaOutput,
} from '@orpc/contract'
import {
  Procedure,
  type ProcedureFunc,
} from './procedure'
import { decorateProcedure } from './procedure-decorated'
import { ProcedureImplementer } from './procedure-implementer'

export interface ProcedureBuilderDef<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
> {
  contract: ContractProcedure<TInputSchema, TOutputSchema>
  middlewares?: Middleware<MergeContext<TContext, TExtraContext>, Partial<TExtraContext> | undefined, unknown, any>[]
}

export class ProcedureBuilder<
  TContext extends Context,
  TExtraContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
> {
  '~type' = 'ProcedureBuilder' as const
  '~orpc': ProcedureBuilderDef<TContext, TExtraContext, TInputSchema, TOutputSchema>

  constructor(def: ProcedureBuilderDef<TContext, TExtraContext, TInputSchema, TOutputSchema>) {
    this['~orpc'] = def
  }

  route(route: RouteOptions): ProcedureBuilder<TContext, TExtraContext, TInputSchema, TOutputSchema> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      contract: DecoratedContractProcedure
        .decorate(this['~orpc'].contract)
        .route(route),
    })
  }

  input<U extends Schema = undefined>(
    schema: U,
    example?: SchemaInput<U>,
  ): ProcedureBuilder<TContext, TExtraContext, U, TOutputSchema> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      contract: DecoratedContractProcedure
        .decorate(this['~orpc'].contract)
        .input(schema, example),
    })
  }

  output<U extends Schema = undefined>(
    schema: U,
    example?: SchemaOutput<U>,
  ): ProcedureBuilder<TContext, TExtraContext, TInputSchema, U> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      contract: DecoratedContractProcedure
        .decorate(this['~orpc'].contract)
        .output(schema, example),
    })
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
    middleware: Middleware<any, any, any, any>,
    mapInput?: MapInputMiddleware<any, any>,
  ): ProcedureImplementer<any, any, any, any> {
    if (!mapInput) {
      return new ProcedureImplementer({
        contract: this['~orpc'].contract,
        middlewares: this['~orpc'].middlewares,
      }).use(middleware)
    }

    return new ProcedureImplementer({
      contract: this['~orpc'].contract,
      middlewares: this['~orpc'].middlewares,
    }).use(middleware, mapInput)
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
