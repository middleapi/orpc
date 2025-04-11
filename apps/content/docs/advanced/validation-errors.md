---
title: Validation Errors
description: Learn about oRPC's built-in validation errors and how to customize them.
---

# Validation Errors

oRPC provides built-in validation errors that work well by default. However, you might sometimes want to customize them.

## Customizing with Client Interceptors

[Client Interceptors](/docs/lifecycle) are preferred because they run before error validation, ensuring that your custom errors are properly validated.

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
import { router } from './shared/planet'
// ---cut---
import { onError, ORPCError, ValidationError } from '@orpc/server'
import { ZodError } from 'zod'
import type { ZodIssue } from 'zod'

const handler = new RPCHandler(router, {
  clientInterceptors: [
    onError((error) => {
      if (
        error instanceof ORPCError
        && error.code === 'BAD_REQUEST'
        && error.cause instanceof ValidationError
      ) {
        // If you only use Zod you can safely cast to ZodIssue[]
        const zodError = new ZodError(error.cause.issues as ZodIssue[])

        throw new ORPCError('INPUT_VALIDATION_FAILED', {
          status: 422,
          data: zodError.flatten(),
          cause: error.cause,
        })
      }

      if (
        error instanceof ORPCError
        && error.code === 'INTERNAL_SERVER_ERROR'
        && error.cause instanceof ValidationError
      ) {
        throw new ORPCError('OUTPUT_VALIDATION_FAILED', {
          cause: error.cause,
        })
      }
    }),
  ],
})
```

## Customizing with Middleware

```ts twoslash
import { z, ZodError } from 'zod'
import type { ZodIssue } from 'zod'
import { onError, ORPCError, os, ValidationError } from '@orpc/server'

const base = os.use(onError((error) => {
  if (
    error instanceof ORPCError
    && error.code === 'BAD_REQUEST'
    && error.cause instanceof ValidationError
  ) {
    // If you only use Zod you can safely cast to ZodIssue[]
    const zodError = new ZodError(error.cause.issues as ZodIssue[])

    throw new ORPCError('INPUT_VALIDATION_FAILED', {
      status: 422,
      data: zodError.flatten(),
      cause: error.cause,
    })
  }

  if (
    error instanceof ORPCError
    && error.code === 'INTERNAL_SERVER_ERROR'
    && error.cause instanceof ValidationError
  ) {
    throw new ORPCError('OUTPUT_VALIDATION_FAILED', {
      cause: error.cause,
    })
  }
}))

const getting = base
  .input(z.object({ id: z.string().uuid() }))
  .output(z.object({ id: z.string().uuid(), name: z.string() }))
  .handler(async ({ input, context }) => {
    return { id: input.id, name: 'name' }
  })
```

Every [procedure](/docs/procedure) built from `base` now uses these customized validation errors.

:::warning
Middleware applied before `.input`/`.output` catches validation errors by default, but this behavior can be configured.
:::

## Type‑Safe Validation Errors

As explained in the [error handling guide](/docs/error-handling#combining-both-approaches), when you throw an `ORPCError` instance, if the `code` and `data` match with the errors defined in the `.errors` method, oRPC will treat it exactly as if you had thrown `errors.[code]` using the type‑safe approach.

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
// ---cut---
import { onError, ORPCError, os, ValidationError } from '@orpc/server'
import { z, ZodError } from 'zod'
import type { ZodIssue } from 'zod'

const base = os.errors({
  INPUT_VALIDATION_FAILED: {
    data: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string()).optional()),
    }),
  },
})

const example = base
  .input(z.object({ id: z.string().uuid() }))
  .handler(() => { /** do something */ })

const handler = new RPCHandler({ example }, {
  clientInterceptors: [
    onError((error) => {
      if (
        error instanceof ORPCError
        && error.code === 'BAD_REQUEST'
        && error.cause instanceof ValidationError
      ) {
        // If you only use Zod you can safely cast to ZodIssue[]
        const zodError = new ZodError(error.cause.issues as ZodIssue[])

        throw new ORPCError('INPUT_VALIDATION_FAILED', {
          status: 422,
          data: zodError.flatten(),
          cause: error.cause,
        })
      }
    }),
  ],
})
```
