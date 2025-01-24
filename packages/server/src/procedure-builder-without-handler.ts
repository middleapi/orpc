import type { ContractProcedureDef, ErrorMap, MergedErrorMap, Meta, ORPCErrorConstructorMap, Route, Schema, SchemaInput, SchemaOutput } from '@orpc/contract'
import type { ConflictContextGuard, Context, MergedContext, TypeCurrentContext, TypeInitialContext } from './context'
import type { AnyMiddleware, MapInputMiddleware, Middleware } from './middleware'
import type { ProcedureHandler } from './procedure'
import { mergeErrorMap, mergeMeta, mergeRoute } from '@orpc/contract'
import { decorateMiddleware } from './middleware-decorated'
import { addMiddleware } from './middleware-utils'
import { DecoratedProcedure } from './procedure-decorated'

export interface ProcedureBuilderWithoutHandlerDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  __initialContext?: TypeInitialContext<TInitialContext>
  __currentContext?: TypeCurrentContext<TCurrentContext>
  middlewares: AnyMiddleware[]
  inputValidationIndex: number
  outputValidationIndex: number
}

/**
 * `ProcedureBuilderWithOutput` is a branch of `ProcedureBuilder` which it only missing handler to be able to build a procedure.
 *
 * Why?
 * - prevents override output schema after .output
 * - allows .use between .input and .output
 * - prevents override input schema after .input
 * - allows .use between .input and .output
 */
export class ProcedureBuilderWithoutHandler<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': ProcedureBuilderWithoutHandlerDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  >

  constructor(def: ProcedureBuilderWithoutHandlerDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  >) {
    this['~orpc'] = def
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilderWithoutHandler<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      MergedErrorMap<TErrorMap, U>,
      TMeta
    > {
    return new ProcedureBuilderWithoutHandler({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  meta(
    meta: TMeta,
  ): ProcedureBuilderWithoutHandler<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      TMeta
    > {
    return new ProcedureBuilderWithoutHandler({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(
    route: Route,
  ): ProcedureBuilderWithoutHandler<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      TMeta
    > {
    return new ProcedureBuilderWithoutHandler({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  use<U extends Context>(
    middleware: Middleware<
      TCurrentContext,
      U,
      SchemaOutput<TInputSchema>,
      SchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): ConflictContextGuard<MergedContext<TCurrentContext, U>>
    & ProcedureBuilderWithoutHandler<
      TInitialContext,
      MergedContext<TCurrentContext, U>,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      TMeta
    >

  use<UOutContext extends Context, UInput>(
    middleware: Middleware<
      TCurrentContext,
      UOutContext,
      UInput,
      SchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<SchemaOutput<TInputSchema>, UInput>,
  ): ConflictContextGuard<MergedContext<TCurrentContext, UOutContext>>
    & ProcedureBuilderWithoutHandler<
      TInitialContext,
      MergedContext<TCurrentContext, UOutContext>,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      TMeta
    >

  use(
    middleware: AnyMiddleware,
    mapInput?: MapInputMiddleware<any, any>,
  ): ProcedureBuilderWithoutHandler<any, any, any, any, any, any> {
    const mappedMiddleware = mapInput
      ? decorateMiddleware(middleware).mapInput(mapInput)
      : middleware

    return new ProcedureBuilderWithoutHandler({
      ...this['~orpc'],
      middlewares: addMiddleware(this['~orpc'].middlewares, mappedMiddleware),
    })
  }

  handler<UFuncOutput extends SchemaInput<TOutputSchema>>(
    handler: ProcedureHandler<TCurrentContext, TInputSchema, TOutputSchema, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      UFuncOutput,
      TErrorMap,
      TMeta
    > {
    return new DecoratedProcedure({
      ...this['~orpc'],
      handler,
    })
  }
}
