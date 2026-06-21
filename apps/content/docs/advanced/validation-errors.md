# Validation Errors

oRPC includes built-in validation errors that work well for most cases. Customize them when you need a different message or error shape.

## Customizing

You can catch validation errors with [interceptors](/docs/rpc/handler#interceptors), [client interceptors](/docs/rpc/handler#client-interceptors), or [middleware](/docs/rpc/middleware) applied before `.input` or `.output`.

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
import { router } from './shared/planet'
// ---cut---
import * as z from 'zod'
import { ORPCError, ValidationError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    async ({ next }) => {
      try {
        return await next()
      }
      catch (error) {
        if (
          error instanceof ORPCError
          && error.code === 'BAD_REQUEST'
          && error.cause instanceof ValidationError
        ) {
          // If you only use Zod you can safely cast to ZodIssue[]
          const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])

          throw new ORPCError('INPUT_VALIDATION_FAILED', {
            message: z.prettifyError(zodError),
            data: z.flattenError(zodError),
            cause: error,
          })
        }

        if (
          error instanceof ORPCError
          && error.code === 'INTERNAL_SERVER_ERROR'
          && error.cause instanceof ValidationError
        ) {
          // do not expose validation details for output validation errors
          throw new ORPCError('OUTPUT_VALIDATION_FAILED', {
            cause: error,
          })
        }

        throw error
      }
    },
  ],
})
```

## Typesafe Validation Errors

As explained in the [error handling guide](/docs/error-handling#orpcerror-compatibility), if you throw an `ORPCError` whose `code` and `data` match an error defined with `.errors`, oRPC treats it the same as `errors.[code]`.

This does not work in [interceptors](/docs/rpc/handler#interceptors). Use [client interceptors](/docs/rpc/handler#client-interceptors) or [middleware](/docs/rpc/middleware) applied before `.input` or `.output` instead.

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
// ---cut---
import { ORPCError, os, ValidationError } from '@orpc/server'
import * as z from 'zod'

const base = os.errors({
  INPUT_VALIDATION_FAILED: {
    data: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string()).optional()),
    }),
  },
})

const example = base
  .input(z.object({ id: z.uuid() }))
  .handler(() => { /** do something */ })

const handler = new RPCHandler({ example }, {
  clientInterceptors: [
    async ({ next }) => {
      try {
        return await next()
      }
      catch (error) {
        if (
          error instanceof ORPCError
          && error.code === 'BAD_REQUEST'
          && error.cause instanceof ValidationError
        ) {
          // If you only use Zod you can safely cast to ZodIssue[]
          const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])

          throw new ORPCError('INPUT_VALIDATION_FAILED', {
            message: z.prettifyError(zodError),
            data: z.flattenError(zodError),
            cause: error,
          })
        }

        throw error
      }
    },
  ],
})
```
