import type { AnyORPCError } from '@orpc/client'
import type { AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, InitialInputSchema, InitialOutputSchema, MergedErrorMap, MergedSchema, MetaPlugin, Schema } from '@orpc/contract'
import type { IntersectPick } from '@orpc/shared'
import type { BuilderDefinition } from './builder'
import type { Context, MergedContext, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Lazy } from './lazy'
import type { Middleware } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { ProcedureHandler } from './procedure'
import type { DecoratedProcedure } from './procedure-decorated'
import type { Router } from './router'
import type { AugmentedRouterWithMiddlewares } from './router-utils'

export interface BuilderWithMiddlewares<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TErrorMap extends ErrorMap,
> {
  '~orpc': BuilderDefinition<InitialInputSchema, InitialOutputSchema, TErrorMap>

  'meta'(
    ...plugins: MetaPlugin<InitialInputSchema, InitialOutputSchema, TErrorMap>[]
  ): BuilderWithMiddlewares<TInitialContext, TInjectedContext, TErrorMap>

  'errors'<T extends ErrorMap>(
    errors: T,
  ): BuilderWithMiddlewares<TInitialContext, TInjectedContext, MergedErrorMap<TErrorMap, T>>

  'use'<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $ErrorMap extends ErrorMap = TErrorMap,
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      InferSchemaOutput<InitialInputSchema>,
      InferSchemaInput<InitialOutputSchema>,
      $ErrorMap
    >,
  ): BuilderWithMiddlewares<
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>,
    MergedErrorMap<$ErrorMap, TErrorMap>
  >

  'middleware'<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $Input,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $Output = any, // $Output = any by default is important to make middleware can be used in any output by default,
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      $Input,
      $Output,
      TErrorMap
    >,
  ): DecoratedMiddleware<
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>,
    $Input,
    $Output,
    TErrorMap
  >

  'input'<T extends AnySchema>(
    schema: T
  ): BuilderWithInput<TInitialContext, TInjectedContext, T, TErrorMap>

  'output'<T extends AnySchema>(
    schema: T
  ): BuilderWithOutput<TInitialContext, TInjectedContext, T, TErrorMap>

  'handler'<T>(
    handler: ProcedureHandler<MergedContext<TInitialContext, TInjectedContext>, InferSchemaOutput<InitialInputSchema>, T, ORPCErrorConstructorMap<TErrorMap>>,
  ): DecoratedProcedure<
    TInitialContext,
    TInjectedContext,
    InitialInputSchema,
    Schema<Exclude<T, AnyORPCError>>,
    TErrorMap,
    Extract<T, AnyORPCError>
  >

  'router'<T extends Router<MergedContext<TInitialContext, TInjectedContext>>>(
    router: T,
  ): AugmentedRouterWithMiddlewares<T, TInitialContext, TInjectedContext, TErrorMap>

  'lazy'<T extends Router<MergedContext<TInitialContext, TInjectedContext>>>(
    loader: () => Promise<{ default: T }>,
  ): Lazy<AugmentedRouterWithMiddlewares<T, TInitialContext, TInjectedContext, TErrorMap>>
}

export interface BuilderWithInput<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TInputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  '~orpc': BuilderDefinition<TInputSchema, InitialOutputSchema, TErrorMap>

  'meta'(
    ...plugins: MetaPlugin<TInputSchema, InitialOutputSchema, TErrorMap>[]
  ): BuilderWithInput<TInitialContext, TInjectedContext, TInputSchema, TErrorMap>

  'errors'<T extends ErrorMap>(
    errors: T,
  ): BuilderWithInput<TInitialContext, TInjectedContext, TInputSchema, MergedErrorMap<TErrorMap, T>>

  'use'<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $ErrorMap extends ErrorMap = TErrorMap,
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<InitialOutputSchema>,
      $ErrorMap
    >,
  ): BuilderWithInput<
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>,
    TInputSchema,
    MergedErrorMap<$ErrorMap, TErrorMap>
  >

  'input'<T extends AnySchema>(
    schema: T
  ): BuilderWithInput<TInitialContext, TInjectedContext, MergedSchema<T, TInputSchema>, TErrorMap>

  'output'<T extends AnySchema>(
    schema: T
  ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, T, TErrorMap>

  'handler'<T>(
    handler: ProcedureHandler<MergedContext<TInitialContext, TInjectedContext>, InferSchemaOutput<TInputSchema>, T, ORPCErrorConstructorMap<TErrorMap>>,
  ): DecoratedProcedure<
    TInitialContext,
    TInjectedContext,
    TInputSchema,
    Schema<Exclude<T, AnyORPCError>>,
    TErrorMap,
    Extract<T, AnyORPCError>
  >
}

export interface BuilderWithOutput<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  '~orpc': BuilderDefinition<InitialInputSchema, TOutputSchema, TErrorMap>

  'meta'(
    ...plugins: MetaPlugin<InitialInputSchema, TOutputSchema, TErrorMap>[]
  ): BuilderWithOutput<TInitialContext, TInjectedContext, TOutputSchema, TErrorMap>

  'errors'<T extends ErrorMap>(
    errors: T,
  ): BuilderWithOutput<TInitialContext, TInjectedContext, TOutputSchema, MergedErrorMap<TErrorMap, T>>

  'use'<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $ErrorMap extends ErrorMap = TErrorMap,
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      InferSchemaOutput<InitialInputSchema>,
      InferSchemaInput<TOutputSchema>,
      $ErrorMap
    >,
  ): BuilderWithOutput<
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>,
    TOutputSchema,
    MergedErrorMap<$ErrorMap, TErrorMap>
  >

  'input'<T extends AnySchema>(
    schema: T
  ): BuilderWithInputOutput<TInitialContext, TInjectedContext, T, TOutputSchema, TErrorMap>

  'output'<T extends AnySchema>(
    schema: T
  ): BuilderWithOutput<TInitialContext, TInjectedContext, MergedSchema<T, TOutputSchema>, TErrorMap>

  'handler'<T extends InferSchemaInput<TOutputSchema> | AnyORPCError>(
    handler: ProcedureHandler<MergedContext<TInitialContext, TInjectedContext>, InferSchemaOutput<InitialInputSchema>, T, ORPCErrorConstructorMap<TErrorMap>>,
  ): DecoratedProcedure<TInitialContext, TInjectedContext, InitialInputSchema, TOutputSchema, TErrorMap, Extract<T, AnyORPCError>>
}

export interface BuilderWithInputOutput<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  '~orpc': BuilderDefinition<TInputSchema, TOutputSchema, TErrorMap>

  'meta'(
    ...plugins: MetaPlugin<TInputSchema, TOutputSchema, TErrorMap>[]
  ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap>

  'errors'<T extends ErrorMap>(
    errors: T,
  ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, T>>

  'use'<
    $OutContext extends IntersectPick<MergedContext<TInitialContext, TInjectedContext>, $OutContext>,
    $InContext extends Context = MergedContext<TInitialContext, TInjectedContext>,
    $ErrorMap extends ErrorMap = TErrorMap,
  >(
    middleware: Middleware<
      $InContext | MergedContext<TInitialContext, TInjectedContext>,
      $OutContext,
      InferSchemaOutput<TInputSchema>,
      InferSchemaInput<TOutputSchema>,
      $ErrorMap
    >,
  ): BuilderWithInputOutput<
    MergedInitialContext<TInitialContext, TInjectedContext, $InContext>,
    MergedContext<TInjectedContext, $OutContext>,
    TInputSchema,
    TOutputSchema,
    MergedErrorMap<$ErrorMap, TErrorMap>
  >

  'input'<T extends AnySchema>(
    schema: T
  ): BuilderWithInputOutput<TInitialContext, TInjectedContext, MergedSchema<T, TInputSchema>, TOutputSchema, TErrorMap>

  'output'<T extends AnySchema>(
    schema: T
  ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, MergedSchema<T, TOutputSchema>, TErrorMap>

  'handler'<T extends InferSchemaInput<TOutputSchema> | AnyORPCError>(
    handler: ProcedureHandler<MergedContext<TInitialContext, TInjectedContext>, InferSchemaOutput<TInputSchema>, T, ORPCErrorConstructorMap<TErrorMap>>,
  ): DecoratedProcedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, Extract<T, AnyORPCError>>
}
