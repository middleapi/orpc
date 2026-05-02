---
title: Procedure Builder in Mini oRPC
description: Learn how Mini oRPC's procedure builder provides an excellent developer experience for defining type-safe procedures.
---

# Procedure Builder in Mini oRPC

The procedure builder is Mini oRPC's core component that enables you to define type-safe procedures with an intuitive, fluent API.

::: info
The complete Mini oRPC implementation is available in our GitHub repository: [Mini oRPC Repository](https://github.com/middleapi/mini-orpc)
:::

## Implementation

Here is the complete procedure builder system implementation over the basic [procedure](/docs/procedure), [middleware](/docs/middleware), and [context](/docs/context) systems in Mini oRPC:

::: code-group

```ts [server/src/builder.ts]
import type { IntersectPick } from '@orpc/shared'
import type { Middleware } from './middleware'
import type { ProcedureDef, ProcedureHandler } from './procedure'
import type { AnySchema, Context, InferSchemaInput, InferSchemaOutput, Schema, } from './types'
import { Procedure } from './procedure'

export interface BuilderDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
> extends Omit<
    ProcedureDef<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema>,
    'handler'
  > {}

export class Builder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
> {
  /**
   * Holds the builder configuration.
   */
  '~orpc': BuilderDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema
  >

  constructor(
    def: BuilderDef<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema
    >
  ) {
    this['~orpc'] = def
  }

  /**
   * Sets the initial context type.
   */
  $context<U extends Context>(): Builder<
    U & Record<never, never>,
    U,
    TInputSchema,
    TOutputSchema
  > {
    // `& Record<never, never>` prevents "has no properties in common" TypeScript errors
    return new Builder({
      ...this['~orpc'],
      middlewares: [],
    })
  }

  /**
   * Creates a middleware function.
   */
  middleware<UOutContext extends IntersectPick<TCurrentContext, UOutContext>>(
    middleware: Middleware<TInitialContext, UOutContext>
  ): Middleware<TInitialContext, UOutContext> {
    // Ensures UOutContext doesn't conflict with current context
    return middleware
  }

  /**
   * Applies middleware to transform context or enhance the pipeline.
   */
  use<UOutContext extends IntersectPick<TCurrentContext, UOutContext>>(
    middleware: Middleware<TCurrentContext, UOutContext>
  ): Builder<
    TInitialContext,
    Omit<TCurrentContext, keyof UOutContext> & UOutContext,
    TInputSchema,
    TOutputSchema
  > {
    // UOutContext merges with and overrides current context properties
    return new Builder({
      ...this['~orpc'],
      middlewares: [...this['~orpc'].middlewares, middleware],
    })
  }

  /**
   * Sets the input validation schema.
   */
  input<USchema extends AnySchema>(
    schema: USchema
  ): Builder<TInitialContext, TCurrentContext, USchema, TOutputSchema> {
    return new Builder({
      ...this['~orpc'],
      inputSchema: schema,
    })
  }

  /**
   * Sets the output validation schema.
   */
  output<USchema extends AnySchema>(
    schema: USchema
  ): Builder<TInitialContext, TCurrentContext, TInputSchema, USchema> {
    return new Builder({
      ...this['~orpc'],
      outputSchema: schema,
    })
  }

  /**
   * Defines the procedure handler and creates the final procedure.
   */
  handler<UFuncOutput extends InferSchemaInput<TOutputSchema>>(
    handler: ProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      UFuncOutput
    >
  ): Procedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema extends { initial?: true }
      ? Schema<UFuncOutput>
      : TOutputSchema
  > {
    // If no output schema is defined, infer it from handler return type
    return new Procedure({
      ...this['~orpc'],
      handler,
    }) as any
  }
}

export const os = new Builder<
  Record<never, never>,
  Record<never, never>,
  Schema<unknown, unknown>,
  Schema<unknown, unknown> & { initial?: true }
>({
  middlewares: [],
})
```

```ts [server/src/procedure.ts]
import type { AnyMiddleware } from './middleware'
import type { AnySchema, Context } from './types'

export interface ProcedureHandlerOptions<
  TCurrentContext extends Context,
  TInput,
> {
  context: TCurrentContext
  input: TInput
  path: readonly string[]
  procedure: AnyProcedure
  signal?: AbortSignal
}

export interface ProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  THandlerOutput,
> {
  (
    opt: ProcedureHandlerOptions<TCurrentContext, TInput>
  ): Promise<THandlerOutput>
}

export interface ProcedureDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
> {
  /**
   * This property must be optional, because it only available in the type system.
   *
   * Why `(type: TInitialContext) => unknown` instead of `TInitialContext`?
   * You can read detail about this topic [here](https://www.typescriptlang.org/docs/handbook/2/generics.html#variance-annotations)
   */
  __initialContext?: (type: TInitialContext) => unknown
  middlewares: readonly AnyMiddleware[]
  inputSchema?: TInputSchema
  outputSchema?: TOutputSchema
  handler: ProcedureHandler<TCurrentContext, any, any>
}

export class Procedure<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
> {
  '~orpc': ProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema
  >

  constructor(
    def: ProcedureDef<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema
    >
  ) {
    this['~orpc'] = def
  }
}

export type AnyProcedure = Procedure<any, any, any, any>

/**
 * TypeScript only enforces type constraints at compile time.
 * Checking only `item instanceof Procedure` would fail for objects
 * that have the same structure as `Procedure` but aren't actual
 * instances of the `Procedure` class.
 */
export function isProcedure(item: unknown): item is AnyProcedure {
  if (item instanceof Procedure) {
    return true
  }

  return (
    (typeof item === 'object' || typeof item === 'function')
    && item !== null
    && '~orpc' in item
    && typeof item['~orpc'] === 'object'
    && item['~orpc'] !== null
    && 'middlewares' in item['~orpc']
    && 'handler' in item['~orpc']
  )
}
```

```ts [server/src/middleware.ts]
import type { MaybeOptionalOptions, Promisable } from '@orpc/shared'
import type { AnyProcedure } from './procedure'
import type { Context } from './types'

export type MiddlewareResult<TOutContext extends Context> = Promisable<{
  output: any
  context: TOutContext
}>

/**
 * By conditional checking `Record<never, never> extends TOutContext`
 * users can avoid declaring `context` when TOutContext can be empty.
 *
 */
export type MiddlewareNextFnOptions<TOutContext extends Context> = Record<
  never,
  never
> extends TOutContext
  ? { context?: TOutContext }
  : { context: TOutContext }

export interface MiddlewareNextFn {
  <U extends Context = Record<never, never>>(
    ...rest: MaybeOptionalOptions<MiddlewareNextFnOptions<U>>
  ): MiddlewareResult<U>
}

export interface MiddlewareOptions<TInContext extends Context> {
  context: TInContext
  path: readonly string[]
  procedure: AnyProcedure
  signal?: AbortSignal
  next: MiddlewareNextFn
}

export interface Middleware<
  TInContext extends Context,
  TOutContext extends Context,
> {
  (
    options: MiddlewareOptions<TInContext>
  ): Promisable<MiddlewareResult<TOutContext>>
}

export type AnyMiddleware = Middleware<any, any>
```

:::

## Router System

The router is another essential component of oRPC that organizes procedures into logical groups and handles routing based on procedure paths. It provides a hierarchical structure for your API endpoints.

::: code-group

```ts [server/src/router.ts]
import type { Procedure } from './procedure'
import type { Context } from './types'

/**
 * Router can be either a single procedure or a nested object of routers.
 * This recursive structure allows for unlimited nesting depth.
 */
export type Router<T extends Context>
  = | Procedure<T, any, any, any>
    | { [k: string]: Router<T> }

export type AnyRouter = Router<any>

/**
 * Utility type that extracts the initial context types
 * from all procedures within a router.
 */
export type InferRouterInitialContexts<T extends AnyRouter>
  = T extends Procedure<infer UInitialContext, any, any, any>
    ? UInitialContext
    : {
        [K in keyof T]: T[K] extends AnyRouter
          ? InferRouterInitialContexts<T[K]>
          : never;
      }
```

:::

## Usage

This implementation covers 60-70% of oRPC procedure building. Here are practical examples:

```ts
// Define reusable authentication middleware
const authMiddleware = os
  .$context<{ user?: { id: string, name: string } }>()
  .middleware(async ({ context, next }) => {
    if (!context.user) {
      throw new Error('Unauthorized')
    }

    return next({
      context: {
        user: context.user
      }
    })
  })

// Public procedure with input validation
export const listPlanet = os
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    // Fetch planets with pagination
    return [{ id: 1, name: 'Earth' }]
  })

// Protected procedure with context and middleware
export const createPlanet = os
  .$context<{ user?: { id: string, name: string } }>()
  .use(authMiddleware)
  .input(PlanetSchema.omit({ id: true }))
  .handler(async ({ input, context }) => {
    // Create new planet (user is guaranteed to exist via middleware)
    return { id: 2, name: input.name }
  })

export const router = {
  listPlanet,
  createPlanet,
}
```
