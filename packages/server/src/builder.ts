import type { AnyORPCError } from '@orpc/client'
import type { AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, InitialInputSchema, InitialOutputSchema, MergedErrorMap, MetaPlugin, ProcedureContractDefinition, Schema } from '@orpc/contract'
import type { IntersectPick } from '@orpc/shared'
import type { BuilderWithInput, BuilderWithMiddlewares, BuilderWithOutput } from './builder-variants'
import type { Context, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Middleware } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { OrderedMiddleware, ProcedureConfig, ProcedureHandler } from './procedure'
import type { AnyRouter } from './router'
import type { AugmentedRouter } from './router-utils'
import { getHiddenMetaPlugins, mergeErrorMap, resolveMetaPlugins } from '@orpc/contract'
import { toArray } from '@orpc/shared'
import { Lazy } from './lazy'
import { decorateMiddleware } from './middleware-decorated'
import { DecoratedProcedure } from './procedure-decorated'
import { augmentRouter } from './router-utils'

export interface DefaultInitialContext {
}

export interface BuilderDefinition<
  TInputSchema extends AnySchema,
  TInjectedContext extends AnySchema,
  TErrorMap extends ErrorMap,
>extends ProcedureContractDefinition<TInputSchema, TInjectedContext, TErrorMap>, ProcedureConfig {
  orderedMiddlewares: OrderedMiddleware[]
}

export class Builder<
  TInitialContext extends Context,
  TErrorMap extends ErrorMap,
> {
  '~orpc': BuilderDefinition<InitialInputSchema, InitialOutputSchema, TErrorMap>

  private constructor(definition: BuilderDefinition<InitialInputSchema, InitialOutputSchema, TErrorMap>) {
    this['~orpc'] = definition
  }

  static create<T extends Context = DefaultInitialContext>(): Builder<T & object, Record<never, never>> {
    // Using `& object` avoids "has no properties in common with type" errors
    // when combining procedures or routers with compatible but non-overlapping contexts.

    return new Builder({
      errorMap: {},
      meta: {},
      orderedMiddlewares: [],
    })
  }

  $context<T extends Context = DefaultInitialContext>(): Builder<T & object, TErrorMap> {
    // Using `& object` avoids "has no properties in common with type" errors
    // when combining procedures or routers with compatible but non-overlapping contexts.

    // because we can't call $context after .use method so we don't need reset middlewares here
    return this as any
  }

  $config(config: ProcedureConfig): Builder<TInitialContext, TErrorMap> {
    return new Builder({
      ...this['~orpc'],
      ...config,
    })
  }

  meta(
    ...plugins: MetaPlugin<InitialInputSchema, InitialOutputSchema, TErrorMap>[]
  ): Builder<TInitialContext, TErrorMap> {
    const [meta, metaPlugins] = resolveMetaPlugins(
      this['~orpc'].meta,
      this['~orpc'].metaPlugins,
      plugins,
    )

    return new Builder({
      ...this['~orpc'],
      meta,
      metaPlugins,
    })
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): Builder<TInitialContext, MergedErrorMap<TErrorMap, U>> {
    let builder = new Builder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })

    const plugins = getHiddenMetaPlugins(errors)
    if (plugins) {
      builder = builder.meta(...plugins) as any
    }

    return builder as any
  }

  use<
    $OutContext extends IntersectPick<TInitialContext, $OutContext>,
    $InContext extends Context = TInitialContext,
    $ErrorMap extends ErrorMap = TErrorMap,
  >(
    middleware: Middleware<
      $InContext | TInitialContext,
      $OutContext,
      InferSchemaOutput<InitialInputSchema>,
      InferSchemaInput<InitialOutputSchema>,
      $ErrorMap
    >,
  ): BuilderWithMiddlewares<
    MergedInitialContext<TInitialContext, object, $InContext>,
    $OutContext,
    MergedErrorMap<$ErrorMap, TErrorMap>
  > {
    let builder = new Builder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(middleware['~orpc']?.errorMap ?? {}, this['~orpc'].errorMap),
      orderedMiddlewares: [...this['~orpc'].orderedMiddlewares, {
        middleware,
        inputSchemasLengthAtUse: this['~orpc'].inputSchemas?.length,
        outputSchemasLengthAtUse: this['~orpc'].outputSchemas?.length,
      }],
    })

    if (middleware['~orpc']?.metaPlugins) {
      builder = builder.meta(...middleware['~orpc']?.metaPlugins) as any
    }

    return builder as any
  }

  middleware<
    $OutContext extends IntersectPick<TInitialContext, $OutContext>,
    $Input,
    $Output = any, // $Output = any by default is important to make middleware can be used in any output by default
  >(
    middleware: Middleware<TInitialContext, $OutContext, $Input, $Output, TErrorMap>,
  ): DecoratedMiddleware<TInitialContext, $OutContext, $Input, $Output, TErrorMap> {
    const allMiddlewares = [
      ...this['~orpc'].orderedMiddlewares.map(({ middleware }) => middleware),
      middleware,
    ]

    let current = decorateMiddleware(allMiddlewares.shift()!)

    for (const mid of allMiddlewares) {
      current = current.use(mid) as any
    }

    current['~orpc'] = {
      ...current['~orpc'],
      errorMap: this['~orpc'].errorMap,
      metaPlugins: [
        ...toArray(this['~orpc'].metaPlugins),
        ...toArray(middleware['~orpc']?.metaPlugins),
      ],
    }

    return current
  }

  input<$ extends AnySchema>(schema: $): BuilderWithInput<TInitialContext, object, $, TErrorMap> {
    let builder = new Builder({
      ...this['~orpc'],
      inputSchemas: [...toArray(this['~orpc'].inputSchemas), schema],
    })

    const plugins = getHiddenMetaPlugins(schema)
    if (plugins) {
      builder = builder.meta(...plugins) as any
    }

    return builder as any
  }

  output<$ extends AnySchema>(schema: $): BuilderWithOutput<TInitialContext, object, $, TErrorMap> {
    let builder = new Builder({
      ...this['~orpc'],
      outputSchemas: [...toArray(this['~orpc'].outputSchemas), schema],
    })

    const plugins = getHiddenMetaPlugins(schema)
    if (plugins) {
      builder = builder.meta(...plugins) as any
    }

    return builder as any
  }

  handler<T>(
    handler: ProcedureHandler<TInitialContext, InferSchemaOutput<InitialInputSchema>, T, ORPCErrorConstructorMap<TErrorMap>>,
  ): DecoratedProcedure<
    TInitialContext,
    object,
    InitialInputSchema,
    Schema<Exclude<T, AnyORPCError>>,
    TErrorMap,
    Extract<T, AnyORPCError>
  > {
    let procedure = new DecoratedProcedure({
      ...this['~orpc'],
      handler,
    })

    const plugins = getHiddenMetaPlugins(handler)
    if (plugins) {
      procedure = procedure.meta(...plugins)
    }

    return procedure as any
  }

  router<T extends AnyRouter>(
    router: T,
  ): AugmentedRouter<T, TErrorMap> {
    return augmentRouter(router, {
      ...this['~orpc'],
      middlewares: this['~orpc'].orderedMiddlewares.map(({ middleware }) => middleware),
    }) as any
  }

  lazy<T extends AnyRouter>(
    loader: () => Promise<{ default: T }>,
  ): Lazy<AugmentedRouter<T, TErrorMap>> {
    return new Lazy({
      loader: async () => {
        const { default: router } = await loader()
        return {
          default: this.router(router),
        }
      },
      meta: this['~orpc'].meta,
      metaPlugins: this['~orpc'].metaPlugins,
    })
  }
}

export const os = Builder.create()
