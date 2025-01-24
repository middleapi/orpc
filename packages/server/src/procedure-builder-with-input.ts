import type { ContractProcedureDef, ErrorMap, MergedErrorMap, Meta, ORPCErrorConstructorMap, Route, Schema, SchemaOutput } from '@orpc/contract'
import type { ConflictContextGuard, Context, MergedContext, TypeCurrentContext, TypeInitialContext } from './context'
import type { AnyMiddleware, MapInputMiddleware, Middleware } from './middleware'
import type { ProcedureHandler } from './procedure'
import { mergeErrorMap, mergeMeta, mergeRoute } from '@orpc/contract'
import { decorateMiddleware } from './middleware-decorated'
import { addMiddleware } from './middleware-utils'
import { ProcedureBuilderWithoutHandler } from './procedure-builder-without-handler'
import { DecoratedProcedure } from './procedure-decorated'

export interface ProcedureBuilderWithInputDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends Schema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<TInputSchema, undefined, TErrorMap, TMeta> {
  __initialContext?: TypeInitialContext<TInitialContext>
  __currentContext?: TypeCurrentContext<TCurrentContext>
  middlewares: AnyMiddleware[]
  inputValidationIndex: number
  outputValidationIndex: number
}

/**
 * `ProcedureBuilderWithInput` is a branch of `ProcedureBuilder` which it has input schema.
 *
 * Why?
 * - prevents override input schema after .input
 * - allows .use between .input and .output
 *
 */
export class ProcedureBuilderWithInput<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends Schema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': ProcedureBuilderWithInputDef<TInitialContext, TCurrentContext, TInputSchema, TErrorMap, TMeta>

  constructor(def: ProcedureBuilderWithInputDef<TInitialContext, TCurrentContext, TInputSchema, TErrorMap, TMeta>) {
    this['~orpc'] = def
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilderWithInput<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      MergedErrorMap<TErrorMap, U>,
      TMeta
    > {
    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  meta(
    meta: TMeta,
  ): ProcedureBuilderWithInput<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TErrorMap,
      TMeta
    > {
    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(
    route: Route,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, TInputSchema, TErrorMap, TMeta> {
    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  use<U extends Context>(
    middleware: Middleware<TCurrentContext, U, SchemaOutput<TInputSchema>, unknown, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
  ): ConflictContextGuard<MergedContext<TCurrentContext, U>>
    & ProcedureBuilderWithInput<TInitialContext, MergedContext<TCurrentContext, U>, TInputSchema, TErrorMap, TMeta>

  use<UOutContext extends Context, UInput>(
    middleware: Middleware<TCurrentContext, UOutContext, UInput, unknown, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
    mapInput: MapInputMiddleware<SchemaOutput<TInputSchema>, UInput>,
  ): ConflictContextGuard<MergedContext<TCurrentContext, UOutContext>> &
    ProcedureBuilderWithInput<TInitialContext, MergedContext<TCurrentContext, UOutContext>, TInputSchema, TErrorMap, TMeta>

  use(
    middleware: AnyMiddleware,
    mapInput?: MapInputMiddleware<any, any>,
  ): ProcedureBuilderWithInput<any, any, any, any, any> {
    const maybeWithMapInput = mapInput
      ? decorateMiddleware(middleware).mapInput(mapInput)
      : middleware

    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      outputValidationIndex: this['~orpc'].outputValidationIndex + 1,
      middlewares: addMiddleware(this['~orpc'].middlewares, maybeWithMapInput),
    })
  }

  output<U extends Schema>(
    schema: U,
  ): ProcedureBuilderWithoutHandler<TInitialContext, TCurrentContext, TInputSchema, U, TErrorMap, TMeta> {
    return new ProcedureBuilderWithoutHandler({
      ...this['~orpc'],
      outputSchema: schema,
    })
  }

  handler<UFuncOutput>(
    handler: ProcedureHandler<TCurrentContext, TInputSchema, undefined, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, undefined, UFuncOutput, TErrorMap, TMeta> {
    return new DecoratedProcedure({
      ...this['~orpc'],
      handler,
    })
  }
}
