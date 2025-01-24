import type { ContractRouter, ErrorMap, HTTPPath, MergedErrorMap, Meta, ORPCErrorConstructorMap, TypeMeta } from '@orpc/contract'
import type { ConflictContextGuard, Context, MergedContext, TypeCurrentContext, TypeInitialContext } from './context'
import type { FlattenLazy } from './lazy-utils'
import type { AnyMiddleware, Middleware } from './middleware'
import type { AdaptedRouter, Router } from './router'
import { mergePrefix, mergeTags } from '@orpc/contract'
import { lazy } from './lazy'
import { flatLazy } from './lazy-utils'
import { addMiddleware } from './middleware-utils'
import { adaptRouter } from './router'

export type RouterBuilderDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> = {
  __initialContext?: TypeInitialContext<TInitialContext>
  __currentContext?: TypeCurrentContext<TCurrentContext>
  __meta?: TypeMeta<TMeta>
  prefix?: HTTPPath
  tags?: readonly string[]
  middlewares: AnyMiddleware[]
  errorMap: TErrorMap
}

export class RouterBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  '~orpc': RouterBuilderDef<TInitialContext, TCurrentContext, TErrorMap, TMeta>

  constructor(def: RouterBuilderDef<TInitialContext, TCurrentContext, TErrorMap, TMeta>) {
    this['~orpc'] = def

    if (def.prefix && def.prefix.includes('{')) {
      throw new Error(`
        Dynamic routing in prefix not supported yet.
        Please remove "{" from "${def.prefix}".
      `)
    }
  }

  prefix(prefix: HTTPPath): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new RouterBuilder({
      ...this['~orpc'],
      prefix: mergePrefix(this['~orpc'].prefix, prefix),
    })
  }

  tag(...tags: string[]): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new RouterBuilder({
      ...this['~orpc'],
      tags: mergeTags(this['~orpc'].tags, tags),
    })
  }

  errors<U extends ErrorMap >(
    errors: U,
  ): RouterBuilder<TInitialContext, TCurrentContext, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new RouterBuilder({
      ...this['~orpc'],
      errorMap: {
        ...this['~orpc'].errorMap,
        ...errors,
      },
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
    & RouterBuilder<TInitialContext, MergedContext<TCurrentContext, U>, TErrorMap, TMeta> {
    const builder = new RouterBuilder({
      ...this['~orpc'],
      middlewares: addMiddleware(this['~orpc'].middlewares, middleware),
    })

    return builder as any
  }

  router<U extends Router<TCurrentContext, ContractRouter<TMeta>>>(
    router: U,
  ): AdaptedRouter<U, TInitialContext, TErrorMap> {
    return adaptRouter(router, this['~orpc'])
  }

  lazy<U extends Router<TCurrentContext, ContractRouter<TMeta>>>(
    loader: () => Promise<{ default: U }>,
  ): AdaptedRouter<FlattenLazy<U>, TInitialContext, TErrorMap> {
    return adaptRouter(flatLazy(lazy(loader)), this['~orpc'])
  }
}
