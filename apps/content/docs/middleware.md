# Middleware

Middleware is a powerful mechanism in oRPC that allows you to execute code before and after your procedure handlers, enabling features like authentication, logging, caching, and more. It provides a way to modify the context, input, and output of procedures in a flexible and composable manner.

## Overview

```ts twoslash
import type { AnyMetaPlugin } from '@orpc/server'

declare const someMeta: AnyMetaPlugin
// ---cut---
import { os } from '@orpc/server'

const example = os
  .$context<{ something?: string }>() // <- define initial context
  .meta(someMeta) // <- attach metadata
  .errors({ RATE_LIMITED: {} }) // <- attach errors
  .middleware(async ({ context, next, errors }) => { // <- middleware logic
    try {
      // `await` is required to catch async errors
      return await next({
        context: { // <- Inject additional context
          user: { id: 1, name: 'John' }
        }
      })
    }
    catch (error) {
      console.error(error)
      throw error
    }
    finally {
      // Cleanup logic after execution
    }
  })
```

## Initial Context

Use `.$context` to declare the initial context required when middleware is applied.
Learn more in the [Context Documentation](/docs/context).

## Metadata

Use `.meta` to attach metadata to middleware. This metadata is applied to any procedures that use the middleware. Learn more in the [Metadata documentation](/docs/metadata).

## Typesafe Errors

Use `.errors` to attach error definitions to middleware. These errors are available in the middleware and any procedures that use it. Learn more in the [Typesafe Error Handling documentation](/docs/error-handling#typesafe-errors).

## Middleware Context

Middleware can be used to inject or guard the [context](/docs/context).

```ts twoslash
import { ORPCError, os } from '@orpc/server'

declare function auth(): { userId: number } | null
// ---cut---
const setting = os
  .use(async ({ context, next }) => {
    return next({
      context: {
        auth: await auth() // <- inject auth
      }
    })
  })
  .use(async ({ context, next }) => {
    if (!context.auth) { // <- guard auth
      throw new ORPCError('UNAUTHORIZED')
    }

    return next({
      context: {
        auth: context.auth // <- override auth (now guaranteed to be non-null)
      }
    })
  })
  .handler(async ({ context }) => {
    console.log(context.auth) // <- auth is guaranteed to be non-null here
  })
```

::: warning
Context passed to `next` must not conflict with the existing context; it is merged at runtime.
:::

## Middleware Input

Middleware can access input in type-safe manner, enabling use cases like permission checks.

```ts
const canUpdate = os.middleware(async ({ context, next }, input: number) => {
  // Perform permission check
  return next()
})

const ping = os
  .input(z.number())
  .use(canUpdate) // <- input already matches middleware's expected shape
  .handler(async ({ input }) => {
    // Handler logic
  })

const pong = os
  .input(z.object({ id: z.number() }))
  .use(canUpdate.adaptInput(input => input.id)) // <- adapt input to match middleware's expected shape
  .handler(async ({ input }) => {
    // Handler logic
  })
```

::: info
You can adapt a middleware to accept a different input shape by using `.adaptInput`.

```ts
const canUpdate = os.middleware(async ({ context, next }, input: number) => {
  return next()
})

// Transform middleware to accept a new input shape
const adaptedCanUpdate = canUpdate.adaptInput((input: { id: number }) => input.id)
```

:::

## Middleware Output

Middleware can also modify the output of a handler, such as implementing caching mechanisms.

```ts
const cache = os.middleware(async ({ context, next, path }, input, done) => {
  const cacheKey = path.join('/') + JSON.stringify(input)

  if (db.has(cacheKey)) {
    return done({ output: db.get(cacheKey) })
  }

  const result = await next({})

  db.set(cacheKey, result.output)

  return result
})
```

## Inline Middleware

Middleware is simply a function that can be defined inline with `.use`, which is useful for simple middleware cases.

```ts
const example = os
  .use(async ({ context, next }) => {
    // Execute logic before the handler
    return next()
  })
  .handler(async ({ context }) => {
    // Handler logic
  })
```

## Combining Middleware

Multiple middleware functions can be combined using `.use`.

```ts
const mergedMiddleware = aMiddleware
  .use(async ({ next }) => next())
  .use(anotherMiddleware)
```

::: info
To concatenate two middlewares with different input types, use `.adaptInput` to align their inputs first.
:::
