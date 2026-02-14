import type { HTTPPath } from '@orpc/client'
import type { AnySchema, ContractProcedureDef, ContractRouter, ErrorMap, MergedErrorMap, Meta, Route, Schema } from '@orpc/contract'
import type { IntersectPick } from '@orpc/shared'
import type { BuilderWithMiddlewares, ProcedureBuilder, ProcedureBuilderWithInput, ProcedureBuilderWithOutput, RouterBuilder } from './builder-variants'
import type { Context, MergedCurrentContext, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Lazy } from './lazy'
import type { AnyMiddleware, MapInputMiddleware, Middleware } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { ProcedureHandler } from './procedure'
import type { Router } from './router'
import type { EnhancedRouter, EnhanceRouterOptions } from './router-utils'
import { mergeErrorMap, mergeMeta, mergePrefix, mergeRoute, mergeTags } from '@orpc/contract'
import { fallbackConfig } from './config'
import { lazy } from './lazy'
import { decorateMiddleware } from './middleware-decorated'
import { addMiddleware } from './middleware-utils'
import { DecoratedProcedure } from './procedure-decorated'
import { enhanceRouter } from './router-utils'

export interface BuilderConfig {
  initialInputValidationIndex?: number
  initialOutputValidationIndex?: number
  dedupeLeadingMiddlewares?: boolean
}

export interface BuilderDef<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>, EnhanceRouterOptions<TErrorMap> {
  middlewares: readonly AnyMiddleware[]
  inputValidationIndex: number
  outputValidationIndex: number
  config: BuilderConfig
}

export class Builder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  constructor(def: BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>) {
    this['~orpc'] = def
  }

  /**
   * Sets or overrides the config.
   *
   * @see {@link https://orpc.dev/docs/client/server-side#middlewares-order Middlewares Order Docs}
   * @see {@link https://orpc.dev/docs/best-practices/dedupe-middleware#configuration Dedupe Middleware Docs}
   */
  $config(config: BuilderConfig): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    const inputValidationCount = this['~orpc'].inputValidationIndex - fallbackConfig('initialInputValidationIndex', this['~orpc'].config.initialInputValidationIndex)
    const outputValidationCount = this['~orpc'].outputValidationIndex - fallbackConfig('initialOutputValidationIndex', this['~orpc'].config.initialOutputValidationIndex)

    return new Builder({
      ...this['~orpc'],
      config,
      dedupeLeadingMiddlewares: fallbackConfig('dedupeLeadingMiddlewares', config.dedupeLeadingMiddlewares),
      inputValidationIndex: fallbackConfig('initialInputValidationIndex', config.initialInputValidationIndex) + inputValidationCount,
      outputValidationIndex: fallbackConfig('initialOutputValidationIndex', config.initialOutputValidationIndex) + outputValidationCount,
    })
  }

  /**
   * Set or override the initial context.
   *
   * @see {@link https://orpc.dev/docs/context Context Docs}
   */
  $context<U extends Context>(): Builder<U & Record<never, never>, U, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    /**
     * We need `& Record<never, never>` to deal with `has no properties in common with type` error
     */

    return new Builder({
      ...this['~orpc'],
      middlewares: [],
      inputValidationIndex: fallbackConfig('initialInputValidationIndex', this['~orpc'].config.initialInputValidationIndex),
      outputValidationIndex: fallbackConfig('initialOutputValidationIndex', this['~orpc'].config.initialOutputValidationIndex),
    })
  }

  /**
   * Sets or overrides the initial meta.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  $meta<U extends Meta>(
    initialMeta: U,
  ): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, U & Record<never, never>> {
    /**
     * We need `& Record<never, never>` to deal with `has no properties in common with type` error
     */

    return new Builder({
      ...this['~orpc'],
      meta: initialMeta,
    })
  }

  /**
   * Sets or overrides the initial route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  $route(
    initialRoute: Route,
  ): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      route: initialRoute,
    })
  }

  /**
   * Sets or overrides the initial input schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#initial-configuration Initial Procedure Configuration Docs}
   */
  $input<U extends AnySchema>(
    initialInputSchema?: U,
  ): Builder<TInitialContext, TCurrentContext, U, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      inputSchema: initialInputSchema,
    })
  }

  /**
   * Creates a middleware.
   *
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  middleware<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, TInput, TOutput = any>( // = any here is important to make middleware can be used in any output by default
    middleware: Middleware<TInitialContext, UOutContext, TInput, TOutput, ORPCErrorConstructorMap<TErrorMap>, TMeta>,
  ): DecoratedMiddleware<TInitialContext, UOutContext, TInput, TOutput, any, TMeta> { // any ensures middleware can used in any procedure
    return decorateMiddleware(middleware)
  }

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends ErrorMap>(
    errors: U,
  ): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new Builder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  use<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): BuilderWithMiddlewares<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  >

  use(
    middleware: AnyMiddleware,
    mapInput?: MapInputMiddleware<any, any>,
  ): BuilderWithMiddlewares<any, any, any, any, any, any> {
    const mapped = mapInput
      ? decorateMiddleware(middleware).mapInput(mapInput)
      : middleware

    return new Builder({
      ...this['~orpc'],
      middlewares: addMiddleware(this['~orpc'].middlewares, mapped),
    }) as any
  }

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta(
    meta: TMeta,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  route(
    route: Route,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, USchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      inputSchema: schema,
      inputValidationIndex: fallbackConfig('initialInputValidationIndex', this['~orpc'].config.initialInputValidationIndex) + this['~orpc'].middlewares.length,
    }) as any
  }

  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  output<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TInputSchema, USchema, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      outputSchema: schema,
      outputValidationIndex: fallbackConfig('initialOutputValidationIndex', this['~orpc'].config.initialOutputValidationIndex) + this['~orpc'].middlewares.length,
    }) as any
  }

  /**
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  handler<UFuncOutput>(
    handler: ProcedureHandler<TCurrentContext, unknown, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, Schema<UFuncOutput, UFuncOutput>, TErrorMap, TMeta> {
    return new DecoratedProcedure({
      ...this['~orpc'],
      handler,
    })
  }

  /**
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  prefix(
    prefix: HTTPPath,
  ): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      prefix: mergePrefix(this['~orpc'].prefix, prefix),
    }) as any
  }

  /**
   * Adds tags to all procedures in the router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  tag(...tags: string[]): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta> {
    return new Builder({
      ...this['~orpc'],
      tags: mergeTags(this['~orpc'].tags, tags),
    }) as any
  }

  /**
   * Applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  router<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U,
  ): EnhancedRouter<U, TInitialContext, TCurrentContext, TErrorMap> {
    return enhanceRouter(router, this['~orpc']) as any // Type instantiation is excessively deep and possibly infinite
  }

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  lazy<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedRouter<Lazy<U>, TInitialContext, TCurrentContext, TErrorMap> {
    return enhanceRouter(lazy(loader), this['~orpc']) as any // Type instantiation is excessively deep and possibly infinite
  }
}

export const os = new Builder<
  Record<never, never>,
  Record<never, never>,
  Schema<void, unknown>,
  Schema<unknown, unknown>,
  Record<never, never>,
  Record<never, never>
>({
  config: {},
  route: {},
  meta: {},
  errorMap: {},
  inputValidationIndex: fallbackConfig('initialInputValidationIndex'),
  outputValidationIndex: fallbackConfig('initialOutputValidationIndex'),
  middlewares: [],
  dedupeLeadingMiddlewares: true,
})
