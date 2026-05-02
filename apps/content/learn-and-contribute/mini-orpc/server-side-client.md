---
title: Server-side Client in Mini oRPC
description: Learn how to turn a procedure into a callable function in Mini oRPC, enabling server-side client functionality.
---

# Server-side Client in Mini oRPC

The server-side client in Mini oRPC transforms procedures into callable functions, enabling direct server-side invocation. This is the foundation of Mini oRPC client system - all other client functionality builds upon it.

::: info
The complete Mini oRPC implementation is available in our GitHub repository: [Mini oRPC Repository](https://github.com/middleapi/mini-orpc)
:::

## Implementation

Here is the complete implementation of the [server-side client](/docs/client/server-side) functionality in Mini oRPC:

::: code-group

```ts [server/src/procedure-client.ts]
import type { Client } from '@mini-orpc/client'
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { AnyProcedure, Procedure, ProcedureHandlerOptions, } from './procedure'
import type { AnySchema, Context, InferSchemaInput, InferSchemaOutput, } from './types'
import { ORPCError } from '@mini-orpc/client'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { ValidationError } from './error'

export type ProcedureClient<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
> = Client<InferSchemaInput<TInputSchema>, InferSchemaOutput<TOutputSchema>>

/**
 * context can be optional if `Record<never, never> extends TInitialContext`
 */
export type CreateProcedureClientOptions<TInitialContext extends Context> = {
  path?: readonly string[]
} & (Record<never, never> extends TInitialContext
  ? {
      context?: TInitialContext
    }
  : {
      context: TInitialContext
    })

/**
 * Turn a procedure into a callable function
 */
export function createProcedureClient<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
>(
  procedure: Procedure<TInitialContext, any, TInputSchema, TOutputSchema>,
  ...rest: MaybeOptionalOptions<CreateProcedureClientOptions<TInitialContext>>
): ProcedureClient<TInputSchema, TOutputSchema> {
  const options = resolveMaybeOptionalOptions(rest)

  return (...[input, callerOptions]) => {
    return executeProcedureInternal(procedure, {
      context: options.context ?? {},
      input,
      path: options.path ?? [],
      procedure,
      signal: callerOptions?.signal,
    })
  }
}

async function validateInput(
  procedure: AnyProcedure,
  input: unknown
): Promise<any> {
  const schema = procedure['~orpc'].inputSchema

  if (!schema) {
    return input
  }

  const result = await schema['~standard'].validate(input)
  if (result.issues) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Input validation failed',
      data: {
        issues: result.issues,
      },
      cause: new ValidationError({
        message: 'Input validation failed',
        issues: result.issues,
      }),
    })
  }

  return result.value
}

async function validateOutput(
  procedure: AnyProcedure,
  output: unknown
): Promise<any> {
  const schema = procedure['~orpc'].outputSchema

  if (!schema) {
    return output
  }

  const result = await schema['~standard'].validate(output)
  if (result.issues) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Output validation failed',
      cause: new ValidationError({
        message: 'Output validation failed',
        issues: result.issues,
      }),
    })
  }

  return result.value
}

function executeProcedureInternal(
  procedure: AnyProcedure,
  options: ProcedureHandlerOptions<any, any>
): Promise<any> {
  const middlewares = procedure['~orpc'].middlewares
  const inputValidationIndex = 0
  const outputValidationIndex = 0

  const next = async (
    index: number,
    context: Context,
    input: unknown
  ): Promise<unknown> => {
    let currentInput = input

    if (index === inputValidationIndex) {
      currentInput = await validateInput(procedure, currentInput)
    }

    const mid = middlewares[index]

    const output = mid
      ? (
          await mid({
            ...options,
            context,
            next: async (...[nextOptions]) => {
              const nextContext: Context = nextOptions?.context ?? {}

              return {
                output: await next(
                  index + 1,
                  { ...context, ...nextContext },
                  currentInput
                ),
                context: nextContext,
              }
            },
          })
        ).output
      : await procedure['~orpc'].handler({
          ...options,
          context,
          input: currentInput,
        })

    if (index === outputValidationIndex) {
      return await validateOutput(procedure, output)
    }

    return output
  }

  return next(0, options.context, options.input)
}
```

```ts [client/src/error.ts]
import type { MaybeOptionalOptions } from '@orpc/shared'
import { isObject, resolveMaybeOptionalOptions } from '@orpc/shared'

export type ORPCErrorOptions<TData> = ErrorOptions & {
  status?: number
  message?: string
} & (undefined extends TData ? { data?: TData } : { data: TData })

export class ORPCError<TCode extends string, TData> extends Error {
  readonly code: TCode
  readonly status: number
  readonly data: TData

  constructor(
    code: TCode,
    ...rest: MaybeOptionalOptions<ORPCErrorOptions<TData>>
  ) {
    const options = resolveMaybeOptionalOptions(rest)

    if (options?.status && !isORPCErrorStatus(options.status)) {
      throw new Error('[ORPCError] Invalid error status code.')
    }

    super(options.message, options)

    this.code = code
    this.status = options.status ?? 500 // Default to 500 if not provided
    this.data = options.data as TData // data only optional when TData is undefinable so can safely cast here
  }

  toJSON(): ORPCErrorJSON<TCode, TData> {
    return {
      code: this.code,
      status: this.status,
      message: this.message,
      data: this.data,
    }
  }
}

export type ORPCErrorJSON<TCode extends string, TData> = Pick<
  ORPCError<TCode, TData>,
  'code' | 'status' | 'message' | 'data'
>

export function isORPCErrorStatus(status: number): boolean {
  return status < 200 || status >= 400
}

export function isORPCErrorJson(
  json: unknown
): json is ORPCErrorJSON<string, unknown> {
  if (!isObject(json)) {
    return false
  }

  const validKeys = ['code', 'status', 'message', 'data']
  if (Object.keys(json).some(k => !validKeys.includes(k))) {
    return false
  }

  return (
    'code' in json
    && typeof json.code === 'string'
    && 'status' in json
    && typeof json.status === 'number'
    && isORPCErrorStatus(json.status)
    && 'message' in json
    && typeof json.message === 'string'
  )
}
```

```ts [client/src/types.ts]
export interface ClientOptions {
  signal?: AbortSignal
}

export type ClientRest<TInput> = undefined extends TInput
  ? [input?: TInput, options?: ClientOptions]
  : [input: TInput, options?: ClientOptions]

export interface Client<TInput, TOutput> {
  (...rest: ClientRest<TInput>): Promise<TOutput>
}

export type NestedClient = Client<any, any> | { [k: string]: NestedClient }
```

:::

## Router Client

Creating a client for each procedure individually can be tedious. Here is how to create a router client that handles multiple procedures:

::: code-group

```ts [server/src/router-client.ts]
import type { MaybeOptionalOptions } from '@orpc/shared'
import type { Procedure } from './procedure'
import type { CreateProcedureClientOptions, ProcedureClient } from './procedure-client'
import type { AnyRouter, InferRouterInitialContexts } from './router'
import { get, resolveMaybeOptionalOptions, toArray } from '@orpc/shared'
import { isProcedure } from './procedure'
import { createProcedureClient } from './procedure-client'

export type RouterClient<TRouter extends AnyRouter> = TRouter extends Procedure<
  any,
  any,
  infer UInputSchema,
  infer UOutputSchema
>
  ? ProcedureClient<UInputSchema, UOutputSchema>
  : {
      [K in keyof TRouter]: TRouter[K] extends AnyRouter
        ? RouterClient<TRouter[K]>
        : never;
    }

/**
 * Turn a router into a chainable procedure client.
 */
export function createRouterClient<T extends AnyRouter>(
  router: T,
  ...rest: MaybeOptionalOptions<
    CreateProcedureClientOptions<InferRouterInitialContexts<T>>
  >
): RouterClient<T> {
  const options = resolveMaybeOptionalOptions(rest)

  if (isProcedure(router)) {
    const caller = createProcedureClient(router, options)

    return caller as RouterClient<T>
  }

  const recursive = new Proxy(router, {
    get(target, key) {
      if (typeof key !== 'string') {
        return Reflect.get(target, key)
      }

      const next = get(router, [key]) as AnyRouter | undefined

      if (!next) {
        return Reflect.get(target, key)
      }

      return createRouterClient(next, {
        ...options,
        path: [...toArray(options.path), key],
      })
    },
  })

  return recursive as unknown as RouterClient<T>
}
```

:::

## Usage

Transform any procedure or router into a callable client for server-side use:

```ts
// Create a client for a single procedure
const procedureClient = createProcedureClient(myProcedure, {
  context: { userId: '123' },
})

const result = await procedureClient({ input: 'example' })

// Create a client for an entire router
const routerClient = createRouterClient(myRouter, {
  context: { userId: '123' },
})

const result = await routerClient.someProcedure({ input: 'example' })
```
