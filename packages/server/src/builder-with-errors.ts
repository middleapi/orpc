import type { ContractProcedureDef, ContractRouter, ErrorMap, HTTPPath, MergedErrorMap, Meta, ORPCErrorConstructorMap, Route, Schema } from '@orpc/contract'
import type { ConflictContextGuard, Context, MergedContext, TypeInitialContext } from './context'
import type { FlattenLazy } from './lazy-utils'
import type { Middleware } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { ProcedureHandler } from './procedure'
import type { AdaptedRouter, Router } from './router'
import { mergeErrorMap, mergeMeta, mergeRoute } from '@orpc/contract'
import { BuilderWithMiddlewares } from './builder-with-middlewares'
import { lazy } from './lazy'
import { flatLazy } from './lazy-utils'
import { decorateMiddleware } from './middleware-decorated'
import { ProcedureBuilder } from './procedure-builder'
import { ProcedureBuilderWithInput } from './procedure-builder-with-input'
import { ProcedureBuilderWithOutput } from './procedure-builder-with-output'
import { DecoratedProcedure } from './procedure-decorated'
import { adaptRouter } from './router'
import { RouterBuilder } from './router-builder'

export interface BuilderWithErrorsDef<
  TInitialContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<undefined, undefined, TErrorMap, TMeta> {
  __initialContext?: TypeInitialContext<TInitialContext>
  inputValidationIndex: number
  outputValidationIndex: number
}

/**
 * `BuilderWithErrors` is a branch of `Builder` which it has error map.
 *
 * Why?
 * - prevents .contract after .errors (add error map to existing contract can make the contract invalid)
 *
 */
export class BuilderWithErrors<
  TInitialContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': BuilderWithErrorsDef<TInitialContext, TErrorMap, TMeta>

  constructor(def: BuilderWithErrorsDef<TInitialContext, TErrorMap, TMeta>) {
    this['~orpc'] = def
  }

  middleware<UOutContext extends Context, TInput, TOutput = any>( // = any here is important to make middleware can be used in any output by default
    middleware: Middleware<TInitialContext, UOutContext, TInput, TOutput, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
  ): DecoratedMiddleware<TInitialContext, UOutContext, TInput, TOutput, ORPCErrorConstructorMap<TErrorMap>, TMeta> {
    return decorateMiddleware(middleware)
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): BuilderWithErrors<TInitialContext, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new BuilderWithErrors({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  use<U extends Context>(
    middleware: Middleware<TInitialContext, U, unknown, unknown, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
  ): ConflictContextGuard<MergedContext<TInitialContext, U>>
    & BuilderWithMiddlewares<TInitialContext, MergedContext< TInitialContext, U>, TErrorMap, TMeta> {
    const builder = new BuilderWithMiddlewares<TInitialContext, MergedContext<TInitialContext, U>, TErrorMap, TMeta>({
      ...this['~orpc'],
      middlewares: [middleware],
      inputValidationIndex: this['~orpc'].inputValidationIndex + 1,
      outputValidationIndex: this['~orpc'].outputValidationIndex + 1,
    })

    return builder as typeof builder & ConflictContextGuard<MergedContext<TInitialContext, U>>
  }

  meta(meta: TMeta): ProcedureBuilder<TInitialContext, TInitialContext, TErrorMap, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      middlewares: [],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(route: Route): ProcedureBuilder<TInitialContext, TInitialContext, TErrorMap, TMeta> {
    return new ProcedureBuilder({
      ...this['~orpc'],
      middlewares: [],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  input<USchema extends Schema>(
    schema: USchema,
  ): ProcedureBuilderWithInput<TInitialContext, TInitialContext, USchema, TErrorMap, TMeta> {
    return new ProcedureBuilderWithInput({
      ...this['~orpc'],
      middlewares: [],
      inputSchema: schema,
    })
  }

  output<USchema extends Schema>(
    schema: USchema,
  ): ProcedureBuilderWithOutput<TInitialContext, TInitialContext, USchema, TErrorMap, TMeta> {
    return new ProcedureBuilderWithOutput({
      ...this['~orpc'],
      middlewares: [],
      outputSchema: schema,
    })
  }

  handler<UFuncOutput>(
    handler: ProcedureHandler<TInitialContext, undefined, undefined, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TInitialContext, undefined, undefined, UFuncOutput, TErrorMap, TMeta> {
    return new DecoratedProcedure({
      ...this['~orpc'],
      middlewares: [],
      handler,
    })
  }

  prefix(prefix: HTTPPath): RouterBuilder<TInitialContext, TInitialContext, TErrorMap, TMeta> {
    return new RouterBuilder({
      middlewares: [],
      errorMap: this['~orpc'].errorMap,
      prefix,
    })
  }

  tag(...tags: string[]): RouterBuilder<TInitialContext, TInitialContext, TErrorMap, TMeta> {
    return new RouterBuilder({
      middlewares: [],
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
