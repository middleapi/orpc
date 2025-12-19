---
title: Protected Procedures
description: Learn how to create protected procedures with authentication middleware
---

# Protected Procedures

You can build protected procedures by defining [errors](/docs/error-handling) in your contract, chaining authentication [middleware](/docs/middleware) on top of a implementer, and then using it in your procedures.

## Define Error in Contracts

Define errors in your contracts using the `.errors()` method. This allows the client to know exactly what errors a procedure can throw.

```ts twoslash
import { oc } from '@orpc/contract'
import * as z from 'zod'
// ---cut---
export const contract = oc
  .errors({
    UNAUTHORIZED: {
      message: 'User is not authenticated',
    },
  })
  .input(
    z.object({
      id: z.number()
    })
  )
  .output(
    z.object({
      id: z.number(),
      name: z.string()
    })
  )
```

## Type-Safe Errors in Middleware

Middlewares can also throw type-safe errors. However, once not every procedure defined in your contract contains the error used in the middleware, you must use **type narrowing** to make the error accessible from the `errors` object.

```ts
export const authMiddleware = implement(contract)
  .$context<{ user?: { id: string, email: string } }>()
  .middleware(({ context, next, errors }) => {
    // Type narrowing: Check if UNAUTHORIZED error is defined in the contract
    if (!('UNAUTHORIZED' in errors)) {
      throw new Error('Contract is missing UNAUTHORIZED error')
    }

    if (!context.user) {
      // Throw type-safe error
      throw errors.UNAUTHORIZED()
    }

    return next({
      context: {
        user: context.user,
      },
    })
  })
```

## Setting Up Protected Procedures

Start by creating a public implementer with your contract. Then extend it with an authentication middleware to create the protected one:

```ts twoslash
export const pub = implement(contract)
  .use(dbProviderMiddleware)

export const authed = pub
  .use(authMiddleware)
```

:::info
By using `pub.use(authMiddleware)`, the protected implementer inherits all middleware from the public implementer and adds authentication on top.
:::

## Protect the Procedure

Now use `pub` for public procedures and `authed` for protected ones in your router:

```ts
// Public procedure - no authentication required
export const listPlanets = pub.planet.list
  .handler(async ({ input, context }) => {
    return context.db.planets.list(input.limit, input.cursor)
  })

// Protected procedure - requires authentication
export const createPlanet = authed.planet.create
  .handler(async ({ input, context }) => {
    // context.user is guaranteed to exist here due to authMiddleware
    return context.db.planets.create(input, context.user)
  })
```
