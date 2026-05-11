import type { HTTPPath } from '@orpc/client'
import type { AnySchema, ContractRouter, ErrorMap, InferSchemaInput, InferSchemaOutput, MergedErrorMap, MergedMeta, Meta, Route, Schema } from '@orpc/contract'
import type { IntersectPick } from '@orpc/shared'
import type { BuilderDef } from './builder'
import type { Context, MergedCurrentContext, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Lazy } from './lazy'
import type { MapInputMiddleware, Middleware } from './middleware'
import type { ProcedureHandler } from './procedure'
import type { DecoratedProcedure } from './procedure-decorated'
import type { Router } from './router'
import type { EnhancedRouter, EnhanceRouterOptions } from './router-utils'

export interface BuilderWithMiddlewares<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): BuilderWithMiddlewares<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    MergedErrorMap<TErrorMap, U>,
    TMeta,
    TMetaDef
  >

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
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
    TMeta,
    TMetaDef
  >

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  'meta'<const U extends Partial<TMetaDef>>(
    meta: U,
  ): BuilderWithMiddlewares<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  'route'(
    route: Route,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  'input'<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, USchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  'output'<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TInputSchema, USchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  'handler'<UFuncOutput>(
    handler: ProcedureHandler<TCurrentContext, unknown, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, Schema<UFuncOutput, UFuncOutput>, TErrorMap, TMeta, TMetaDef>

  /**
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  'prefix'(prefix: HTTPPath): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta, TMetaDef>

  /**
   * Adds tags to all procedures in the router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  'tag'(...tags: string[]): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta, TMetaDef>

  /**
   * Applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  'router'<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U
  ): EnhancedRouter<U, TInitialContext, TCurrentContext, TErrorMap>

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  'lazy'<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedRouter<Lazy<U>, TInitialContext, TCurrentContext, TErrorMap>
}

export interface ProcedureBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    MergedErrorMap<TErrorMap, U>,
    TMeta,
    TMetaDef
  >

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): ProcedureBuilder<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  'meta'<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  'route'(
    route: Route,
  ): ProcedureBuilder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  'input'<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, USchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  'output'<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TInputSchema, USchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  'handler'<UFuncOutput>(
    handler: ProcedureHandler<TCurrentContext, unknown, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, Schema<UFuncOutput, UFuncOutput>, TErrorMap, TMeta, TMetaDef>
}

export interface ProcedureBuilderWithInput<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      unknown,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): ProcedureBuilderWithInput<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInput, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      UInput,
      unknown,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): ProcedureBuilderWithInput<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  'meta'<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  'route'(
    route: Route,
  ): ProcedureBuilderWithInput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  'output'<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithInputOutput<TInitialContext, TCurrentContext, TInputSchema, USchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  'handler'<UFuncOutput>(
    handler: ProcedureHandler<TCurrentContext, InferSchemaOutput<TInputSchema>, UFuncOutput, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, Schema<UFuncOutput, UFuncOutput>, TErrorMap, TMeta, TMetaDef>
}

export interface ProcedureBuilderWithOutput<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilderWithOutput<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    MergedErrorMap<TErrorMap, U>,
    TMeta,
    TMetaDef
  >

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): ProcedureBuilderWithOutput<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  'meta'<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  'route'(
    route: Route,
  ): ProcedureBuilderWithOutput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  'input'<USchema extends AnySchema>(
    schema: USchema,
  ): ProcedureBuilderWithInputOutput<TInitialContext, TCurrentContext, USchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  'handler'(
    handler: ProcedureHandler<TCurrentContext, unknown, InferSchemaInput<TOutputSchema>, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>
}

export interface ProcedureBuilderWithInputOutput<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): ProcedureBuilderWithInputOutput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): ProcedureBuilderWithInputOutput<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInput, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      UInput,
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): ProcedureBuilderWithInputOutput<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  'meta'<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ProcedureBuilderWithInputOutput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  'route'(
    route: Route,
  ): ProcedureBuilderWithInputOutput<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the handler of the procedure.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  'handler'(
    handler: ProcedureHandler<TCurrentContext, InferSchemaOutput<TInputSchema>, InferSchemaInput<TOutputSchema>, TErrorMap, TMeta>,
  ): DecoratedProcedure<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>
}

export interface RouterBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> {
  /**
   * This property holds the defined options.
   */
  '~orpc': EnhanceRouterOptions<TErrorMap>

  /**
   * Adds type-safe custom errors.
   * The provided errors are spared-merged with any existing errors.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): RouterBuilder<TInitialContext, TCurrentContext, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  'use'<UOutContext extends IntersectPick<TCurrentContext, UOutContext>, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      ORPCErrorConstructorMap<TErrorMap>,
      TMeta
    >,
  ): RouterBuilder<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TErrorMap,
    TMeta,
    TMetaDef
  >

  /**
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  'prefix'(prefix: HTTPPath): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta, TMetaDef>

  /**
   * Adds tags to all procedures in the router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  'tag'(...tags: string[]): RouterBuilder<TInitialContext, TCurrentContext, TErrorMap, TMeta, TMetaDef>

  /**
   * Applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  'router'<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U
  ): EnhancedRouter<U, TInitialContext, TCurrentContext, TErrorMap>

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  'lazy'<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedRouter<Lazy<U>, TInitialContext, TCurrentContext, TErrorMap>
}
