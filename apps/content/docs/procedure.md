---
title: Procedure
description: Understanding procedures in oRPC
---

# Procedure in oRPC

In oRPC, a procedure is like a standard function but comes with built-in support for:

- Input/output validation
- Middleware
- Dependency injection
- Other extensibility features

## Overview

Here's an example of defining a procedure in oRPC:

```ts
import { os } from '@orpc/server'

const example = os
  .use(aMiddleware) // Apply middleware
  .input(z.object({ name: z.string() })) // Define input validation
  .use(aMiddlewareWithInput, input => input.name) // Use middleware with typed input
  .output(z.object({ id: z.number() })) // Define output validation
  .handler(async ({ input, context }) => { // Define execution logic
    return { id: 1 }
  })
  .callable() // Make the procedure callable like a regular function
  .actionable() // Server Action compatibility
```

:::info
The `.handler` method is the only required step. All other chains are optional.
:::

## Input/Output Validation

oRPC supports [Zod](https://github.com/colinhacks/zod), [Valibot](https://github.com/fabian-hiller/valibot), [Arktype](https://github.com/arktypeio/arktype), and any other [Standard Schema](https://github.com/standard-schema/standard-schema?tab=readme-ov-file#what-schema-libraries-implement-the-spec) library for input and output validation.

::: tip
By explicitly specifying the `.output` or your `handler's return type`, you enable TypeScript to infer the output without parsing the handler's code. This approach can dramatically enhance both type-checking and IDE-suggestion speed.
:::

### `type` Utility

For simple use-case without external libraries, use oRPC's built-in `type` utility. It takes a mapping function as its first argument:

```ts twoslash
import { os, type } from '@orpc/server'

const example = os
  .input(type<{ value: number }>())
  .output(type<{ value: number }, number>(({ value }) => value))
  .handler(async ({ input }) => input)
```

## Using Middleware

The `.use` method allows you to pass [middleware](/docs/middleware), which must call `next` to continue execution.

```ts
const aMiddleware = os.middleware(async ({ context, next }) => next())

const example = os
  .use(aMiddleware) // Apply middleware
  .use(async ({ context, next }) => next()) // Inline middleware
  .handler(async ({ context }) => { /* logic */ })
```

::: info
[Middleware](/docs/middleware) can be applied if the [current context](/docs/context#combining-initial-and-execution-context) meets the [middleware dependent context](/docs/middleware#dependent-context) requirements and does not conflict with the [current context](/docs/context#combining-initial-and-execution-context).
:::

## Initial Configuration

Customize the initial input schema using `.$input`:

```ts
const base = os.$input(z.void())
const base = os.$input<Schema<void, unknown>>()
```

Unlike `.input`, the `.$input` method lets you redefine the input schema after its initial configuration. This is useful when you need to enforce a `void` input when no `.input` is specified.

## Reusability

Each modification to a builder creates a completely new instance, avoiding reference issues. This makes it easy to reuse and extend procedures efficiently.

```ts
const pub = os.use(logMiddleware) // Base setup for procedures that publish
const authed = pub.use(authMiddleware) // Extends 'pub' with authentication

const pubExample = pub.handler(async ({ context }) => { /* logic */ })

const authedExample = pubExample.use(authMiddleware)
```

This pattern helps prevent duplication while maintaining flexibility.
