import type { ContractProcedureDef, ErrorMap, MergedErrorMap, Meta, ORPCErrorConstructorMap, Route, Schema } from '@orpc/contract'
import type { ConflictContextGuard, Context, MergedContext, TypeCurrentContext, TypeInitialContext } from './context'
import type { AnyMiddleware, Middleware } from './middleware'
import type { ProcedureHandler } from './procedure'
import { mergeErrorMap, mergeMeta, mergeRoute } from '@orpc/contract'
import { addMiddleware } from './middleware-utils'
import { ProcedureBuilderWithInput } from './procedure-builder-with-input'
import { ProcedureBuilderWithOutput } from './procedure-builder-with-output'
import { DecoratedProcedure } from './procedure-decorated'

export interface ProcedureBuilderDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<undefined, undefined, TErrorMap, TMeta> {
  __initialContext?: TypeInitialContext<TInitialContext>
  __currentContext?: TypeCurrentContext<TCurrentContext>
  middlewares: AnyMiddleware[]
  inputValidationIndex: number
  outputValidationIndex: number
}

export class ProcedureBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': ProcedureBuilderDef<TInitialContext, TCurrentContext, TErrorMap, TMeta>

  constructor(def: ProcedureBuilderDef<TInitialContext, TCurrentContext, TErrorMap, TMeta>) {
    this['~orpc'] = def
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  meta(
    meta: TMeta,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(
    route: Route,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  use<U extends Context>(
    middleware: Middleware<
      TCurrentContext,
      U,
      unknown,
      unknown,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): ConflictContextGuard<MergedContext<TCurrentContext, U>>
    & ProcedureBuilder<TInitialContext, MergedContext<TCurrentContext, U>, TErrorMap, TMeta> {
    const builder = new ProcedureBuilder({
      ...this['~orpc'],
      middlewares: addMiddleware(this['~orpc'].middlewares, middleware),
      inputValidationIndex: this['~orpc'].inputValidationIndex + 1,
      outputValidationIndex: this['~orpc'].outputValidationIndex + 1,
    })

    return builder as any
  }

  input<U extends Schema>(
    schema: U,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, U, TErrorMap, TMeta> {
    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      inputSchema: schema,
    })
  }

  output<U extends Schema>(
    schema: U,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, U, TErrorMap, TMeta> {
    return new ProcedureBuilderWithOutput({
      ...this['~orpc'],
      outputSchema: schema,
    })
  }

  handler<UFuncOutput>(
    handler: ProcedureHandler<TCurrentContext, undefined, undefined, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, undefined, undefined, UFuncOutput, TErrorMap, TMeta> {
    return new DecoratedProcedure({
      ...this['~orpc'],
      handler,
    })
  }
}
