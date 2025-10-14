---
title: Error Handling
description: Manage errors in oRPC using both traditional and type‑safe strategies.
---

# Error Handling in oRPC

oRPC offers a robust error handling system. You can either throw standard JavaScript errors or, preferably, use the specialized `ORPCError` class to utilize oRPC features.

There are two primary approaches:

- **Normal Approach:** Throw errors directly (using `ORPCError` is recommended for clarity).
- **Type‑Safe Approach:** Predefine error types so that clients can infer and handle errors in a type‑safe manner.

:::warning
The `ORPCError.data` property is sent to the client. Avoid including sensitive information.
:::

## Normal Approach

In the traditional approach you may throw any JavaScript error. However, using the `ORPCError` class improves consistency and ensures that error codes and optional data are handled appropriately.

**Key Points:**

- The first argument is the error code.
- You may optionally include a message, additional error data, or any standard error options.

```ts
const rateLimit = os.middleware(async ({ next }) => {
  throw new ORPCError('RATE_LIMITED', {
    message: 'You are being rate limited',
    data: { retryAfter: 60 }
  })
  return next()
})

const example = os
  .use(rateLimit)
  .handler(async ({ input }) => {
    throw new ORPCError('NOT_FOUND')
    throw new Error('Something went wrong') // <-- will be converted to INTERNAL_SERVER_ERROR
  })
```

::: danger
Do not pass sensitive data in the `ORPCError.data` field.
:::

## Type‑Safe Error Handling

For a fully type‑safe error management experience, define your error types using the `.errors` method. This lets the client infer the error's structure and handle it accordingly. You can use any [Standard Schema](https://github.com/standard-schema/standard-schema?tab=readme-ov-file#what-schema-libraries-implement-the-spec) library to validate error data.

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'
// ---cut---
const base = os.errors({ // <-- common errors
  RATE_LIMITED: {
    data: z.object({
      retryAfter: z.number(),
    }),
  },
  UNAUTHORIZED: {},
})

const rateLimit = base.middleware(async ({ next, errors }) => {
  throw errors.RATE_LIMITED({
    message: 'You are being rate limited',
    data: { retryAfter: 60 }
  })
  return next()
})

const example = base
  .use(rateLimit)
  .errors({
    NOT_FOUND: {
      message: 'The resource was not found', // <-- default message
    },
  })
  .handler(async ({ input, errors }) => {
    throw errors.NOT_FOUND()
  })
```

:::danger
Again, avoid including any sensitive data in the error data since it will be exposed to the client.
:::

Learn more about [Client Error Handling](/docs/client/error-handling).

## Combining Both Approaches

You can combine both strategies seamlessly. When you throw an `ORPCError` instance, if the `code`, `status` and `data` match with the errors defined in the `.errors` method, oRPC will treat it exactly as if you had thrown `errors.[code]` using the type‑safe approach.

```ts
const base = os.errors({ // <-- common errors
  RATE_LIMITED: {
    data: z.object({
      retryAfter: z.number().int().min(1).default(1),
    }),
  },
  UNAUTHORIZED: {},
})

const rateLimit = base.middleware(async ({ next, errors }) => {
  throw errors.RATE_LIMITED({
    message: 'You are being rate limited',
    data: { retryAfter: 60 }
  })
  // OR --- both are equivalent
  throw new ORPCError('RATE_LIMITED', {
    message: 'You are being rate limited',
    data: { retryAfter: 60 }
  })
  return next()
})

const example = base
  .use(rateLimit)
  .handler(async ({ input }) => {
    throw new ORPCError('BAD_REQUEST') // <-- unknown error
  })
```

:::danger
Remember: Since `ORPCError.data` is transmitted to the client, do not include any sensitive information.
:::
