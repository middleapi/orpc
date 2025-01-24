import type { ContractProcedureDef, ContractRouter, ErrorMap, HTTPPath, MergedErrorMap, Meta, ORPCErrorConstructorMap, Route, Schema } from '@orpc/contract'
import type { ConflictContextGuard, Context, MergedContext, TypeCurrentContext, TypeInitialContext } from './context'
import type { FlattenLazy } from './lazy-utils'
import type { AnyMiddleware, Middleware } from './middleware'
import type { ProcedureHandler } from './procedure'
import type { AdaptedRouter, Router } from './router'
import { mergeErrorMap, mergeMeta, mergeRoute } from '@orpc/contract'
import { lazy } from './lazy'
import { flatLazy } from './lazy-utils'
import { addMiddleware } from './middleware-utils'
import { ProcedureBuilder } from './procedure-builder'
import { ProcedureBuilderWithInput } from './procedure-builder-with-input'
import { ProcedureBuilderWithOutput } from './procedure-builder-with-output'
import { DecoratedProcedure } from './procedure-decorated'
import { adaptRouter } from './router'
import { RouterBuilder } from './router-builder'

/**
 * `BuilderWithMiddlewares` is a branch of `Builder` which it has middlewares.
 *
 * Why?
 * - prevents .middleware after .use (can mislead the behavior)
 * - prevents .$context after .use (middlewares required current context, so it tricky when change the current context)
 *
 */
export interface BuilderWithMiddlewaresDef<
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

export class BuilderWithMiddlewares<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': BuilderWithMiddlewaresDef<TInitialContext, TCurrentContext, TErrorMap, TMeta>

  constructor(def: BuilderWithMiddlewaresDef<TInitialContext, TCurrentContext, TErrorMap, TMeta>) {
    this['~orpc'] = def
  }

  use<U extends Context>(
    middleware: Middleware<TCurrentContext, U, unknown, unknown, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
  ): ConflictContextGuard<MergedContext<TCurrentContext, U>>
    & BuilderWithMiddlewares<TInitialContext, MergedContext<TCurrentContext, U>, TErrorMap, TMeta> {
    const builder = new BuilderWithMiddlewares({
      ...this['~orpc'],
      inputValidationIndex: this['~orpc'].inputValidationIndex + 1,
      outputValidationIndex: this['~orpc'].outputValidationIndex + 1,
      middlewares: addMiddleware(this['~orpc'].middlewares, middleware),
    })

    return builder as any
  }

  errors< U extends ErrorMap>(
    errors: U,
  ): BuilderWithMiddlewares<TInitialContext, TCurrentContext, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new BuilderWithMiddlewares({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  meta(meta: TMeta): ProcedureBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(route: Route): ProcedureBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  input<USchema extends Schema>(
    schema: USchema,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, USchema, TErrorMap, TMeta> {
    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      inputSchema: schema,
    })
  }

  output<USchema extends Schema>(
    schema: USchema,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, USchema, TErrorMap, TMeta> {
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

  prefix(prefix: HTTPPath): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new RouterBuilder({
      middlewares: this['~orpc'].middlewares,
      errorMap: this['~orpc'].errorMap,
      prefix,
    })
  }

  tag(...tags: string[]): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new RouterBuilder({
      middlewares: this['~orpc'].middlewares,
      errorMap: this['~orpc'].errorMap,
      tags,
    })
  }

  router<U extends Router<TInitialContext, ContractRouter<TMeta>>>(
    router: U,
  ): AdaptedRouter<U, TInitialContext, TErrorMap> {
    return adaptRouter(router, this['~orpc'])
  }

  lazy<U extends Router<TInitialContext, ContractRouter<TMeta>>>(
    loader: () => Promise<{ default: U }>,
  ): AdaptedRouter<FlattenLazy<U>, TInitialContext, TErrorMap> {
    return adaptRouter(flatLazy(lazy(loader)), this['~orpc'])
  }
}
