---
title: Context
description: Understanding context in oRPC
---

# Context in oRPC

oRPC's context mechanism provides a type-safe dependency injection pattern. It lets you supply required dependencies either explicitly or dynamically through middleware. There are two types:

- **Initial Context:** Provided explicitly when invoking a procedure.
- **Execution Context:** Generated during procedure execution, typically by middleware.

## Initial Context

Initial context is used to define required dependencies (usually environment-specific) that must be passed when calling a procedure.

```ts twoslash
import { os } from '@orpc/server'
// ---cut---
const base = os.$context<{ headers: Headers, env: { DB_URL: string } }>()

const getting = base
  .handler(async ({ context }) => {
    console.log(context.env)
  })

export const router = { getting }
```

When calling that requires initial context, pass it explicitly:

```ts twoslash
import { os } from '@orpc/server'

const base = os.$context<{ headers: Headers, env: { DB_URL: string } }>()

const getting = base
  .handler(async ({ context }) => {

  })

export const router = { getting }
// ---cut---
import { RPCHandler } from '@orpc/server/fetch'

const handler = new RPCHandler(router)

export default function fetch(request: Request) {
  handler.handle(request, {
    context: { // <-- you must pass initial context here
      headers: request.headers,
      env: {
        DB_URL: '***'
      }
    }
  })
}
```

## Execution context

Execution context is computed during the process lifecycle, usually via [middleware](/docs/middleware). It can be used independently or combined with initial context.

```ts twoslash
import { os } from '@orpc/server'
// ---cut---
import { cookies, headers } from 'next/headers'

const base = os.use(async ({ next }) => next({
  context: {
    headers: await headers(),
    cookies: await cookies(),
  },
}))

const getting = base.handler(async ({ context }) => {
  context.cookies.set('key', 'value')
})

export const router = { getting }
```

When using execution context, you don't need to pass any context manually:

```ts twoslash
import { os } from '@orpc/server'
import { cookies, headers } from 'next/headers'

const base = os.use(async ({ next }) => next({
  context: {
    headers: await headers(),
    cookies: await cookies(),
  },
}))

const getting = base.handler(async ({ context }) => {
  context.cookies.set('key', 'value')
})

export const router = { getting }
// ---cut---
import { RPCHandler } from '@orpc/server/fetch'

const handler = new RPCHandler(router)

export default function fetch(request: Request) {
  handler.handle(request) // <-- no need to pass anything more
}
```

## Combining Initial and Execution Context

Often you need both static and dynamic dependencies. Use initial context for environment-specific values (e.g., database URLs) and middleware (execution context) for runtime data (e.g., user authentication).

```ts twoslash
import { ORPCError, os } from '@orpc/server'
// ---cut---
const base = os.$context<{ headers: Headers, env: { DB_URL: string } }>()

const requireAuth = base.middleware(async ({ context, next }) => {
  const user = parseJWT(context.headers.get('authorization')?.split(' ')[1])

  if (user) {
    return next({ context: { user } })
  }

  throw new ORPCError('UNAUTHORIZED')
})

const dbProvider = base.middleware(async ({ context, next }) => {
  const client = new Client(context.env.DB_URL)

  try {
    await client.connect()
    return next({ context: { db: client } })
  }
  finally {
    await client.disconnect()
  }
})

const getting = base
  .use(dbProvider)
  .use(requireAuth)
  .handler(async ({ context }) => {
    console.log(context.db)
    console.log(context.user)
  })
// ---cut-after---
declare function parseJWT(token: string | undefined): { userId: number } | null
declare class Client {
  constructor(url: string)
  connect(): Promise<void>
  disconnect(): Promise<void>
}
```
