import type { ContractProcedureDef, ErrorMap, MergedErrorMap, Meta, ORPCErrorConstructorMap, Route, Schema, SchemaInput } from '@orpc/contract'
import type { ConflictContextGuard, Context, TypeCurrentContext, TypeInitialContext } from './context'
import type { AnyMiddleware, Middleware } from './middleware'
import type { ProcedureHandler } from './procedure'
import { mergeErrorMap, mergeMeta, mergeRoute } from '@orpc/contract'
import { addMiddleware } from './middleware-utils'
import { ProcedureBuilderWithoutHandler } from './procedure-builder-without-handler'
import { DecoratedProcedure } from './procedure-decorated'

export interface ProcedureBuilderWithOutputDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TOutputSchema extends Schema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<undefined, TOutputSchema, TErrorMap, TMeta> {
  __initialContext?: TypeInitialContext<TInitialContext>
  __currentContext?: TypeCurrentContext<TCurrentContext>
  middlewares: AnyMiddleware[]
  inputValidationIndex: number
  outputValidationIndex: number
}

/**
 * `ProcedureBuilderWithOutput` is a branch of `ProcedureBuilder` which it has output schema.
 *
 * Why?
 * - prevents override output schema after .output
 * - allows .use between .input and .output
 *
 */
export class ProcedureBuilderWithOutput<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TOutputSchema extends Schema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': ProcedureBuilderWithOutputDef<TInitialContext, TCurrentContext, TOutputSchema, TErrorMap, TMeta>

  constructor(def: ProcedureBuilderWithOutputDef<TInitialContext, TCurrentContext, TOutputSchema, TErrorMap, TMeta>) {
    this['~orpc'] = def
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new ProcedureBuilderWithOutput({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  meta(
    meta: TMeta,
  ): ProcedureBuilderWithOutput<
      TInitialContext,
      TCurrentContext,
      TOutputSchema,
      TErrorMap,
      TMeta
    > {
    return new ProcedureBuilderWithOutput({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(
    route: Route,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TOutputSchema, TErrorMap, TMeta> {
    return new ProcedureBuilderWithOutput({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  use<U extends Context>(
    middleware: Middleware<TCurrentContext, U, unknown, SchemaInput<TOutputSchema>, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
  ): ConflictContextGuard<TCurrentContext & U>
    & ProcedureBuilderWithOutput<TInitialContext, TCurrentContext & U, TOutputSchema, TErrorMap, TMeta> {
    const builder = new ProcedureBuilderWithOutput({
      ...this['~orpc'],
      inputValidationIndex: this['~orpc'].inputValidationIndex + 1,
      middlewares: addMiddleware(this['~orpc'].middlewares, middleware),
    })

    return builder as any
  }

  input<U extends Schema>(
    schema: U,
  ): ProcedureBuilderWithoutHandler<TInitialContext, TCurrentContext, U, TOutputSchema, TErrorMap, TMeta> {
    return new ProcedureBuilderWithoutHandler({
      ...this['~orpc'],
      inputSchema: schema,
    })
  }

  handler<UFuncOutput extends SchemaInput<TOutputSchema>>(
    handler: ProcedureHandler<TCurrentContext, undefined, TOutputSchema, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, undefined, TOutputSchema, UFuncOutput, TErrorMap, TMeta> {
    return new DecoratedProcedure({
      ...this['~orpc'],
      handler,
    })
  }
}
