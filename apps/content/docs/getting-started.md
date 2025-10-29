---
title: Getting Started
description: Quick guide to oRPC
---

# Getting Started

oRPC (OpenAPI Remote Procedure Call) combines RPC (Remote Procedure Call) with OpenAPI, allowing you to define and call remote (or local) procedures through a type-safe API while adhering to the OpenAPI specification.

oRPC simplifies RPC service definition, making it easy to build scalable applications, from simple scripts to complex microservices.

This guide covers the basics: defining procedures, handling errors, and integrating with popular frameworks.

## Prerequisites

- Node.js 18+ (20+ recommended) | Bun | Deno | Cloudflare Workers
- A package manager: npm | pnpm | yarn | bun | deno
- A TypeScript project (strict mode recommended)

## Installation

::: code-group

```sh [npm]
npm install @orpc/server@latest @orpc/client@latest
```

```sh [yarn]
yarn add @orpc/server@latest @orpc/client@latest
```

```sh [pnpm]
pnpm add @orpc/server@latest @orpc/client@latest
```

```sh [bun]
bun add @orpc/server@latest @orpc/client@latest
```

```sh [deno]
deno add npm:@orpc/server@latest npm:@orpc/client@latest
```

:::

## Define App Router

We'll use [Zod](https://github.com/colinhacks/zod) for schema validation (optional, any [standard schema](https://github.com/standard-schema/standard-schema) is supported).

```ts twoslash
import type { IncomingHttpHeaders } from 'node:http'
import { ORPCError, os } from '@orpc/server'
import * as z from 'zod'

const PlanetSchema = z.object({
  id: z.number().int().min(1),
  name: z.string(),
  description: z.string().optional(),
})

export const listPlanet = os
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    // your list code here
    return [{ id: 1, name: 'name' }]
  })

export const findPlanet = os
  .input(PlanetSchema.pick({ id: true }))
  .handler(async ({ input }) => {
    // your find code here
    return { id: 1, name: 'name' }
  })

export const createPlanet = os
  .$context<{ headers: IncomingHttpHeaders }>()
  .use(({ context, next }) => {
    const user = parseJWT(context.headers.authorization?.split(' ')[1])

    if (user) {
      return next({ context: { user } })
    }

    throw new ORPCError('UNAUTHORIZED')
  })
  .input(PlanetSchema.omit({ id: true }))
  .handler(async ({ input, context }) => {
    // your create code here
    return { id: 1, name: 'name' }
  })

export const router = {
  planet: {
    list: listPlanet,
    find: findPlanet,
    create: createPlanet
  }
}
// ---cut-after---

declare function parseJWT(token: string | undefined): { userId: number } | null
```

## Create Server

Using [Node.js](/docs/adapters/http) as the server runtime, but oRPC also supports other runtimes like Bun, Deno, Cloudflare Workers, etc.

```ts twoslash
import { router } from './shared/planet'
// ---cut---
import { createServer } from 'node:http'
import { RPCHandler } from '@orpc/server/node'
import { CORSPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  plugins: [new CORSPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

const server = createServer(async (req, res) => {
  const result = await handler.handle(req, res, {
    context: { headers: req.headers }
  })

  if (!result.matched) {
    res.statusCode = 404
    res.end('No procedure matched')
  }
})

server.listen(
  3000,
  '127.0.0.1',
  () => console.log('Listening on 127.0.0.1:3000')
)
```

Learn more about [RPCHandler](/docs/rpc-handler).

## Create Client

```ts twoslash
import { router } from './shared/planet'
// ---cut---
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({
  url: 'http://127.0.0.1:3000',
  headers: { Authorization: 'Bearer token' },
})

export const orpc: RouterClient<typeof router> = createORPCClient(link)
```

Supports both [client-side clients](/docs/client/client-side) and [server-side clients](/docs/client/server-side).

## Call Procedure

End-to-end type-safety and auto-completion out of the box.

```ts twoslash
import { orpc } from './shared/planet'
// ---cut---
const planet = await orpc.planet.find({ id: 1 })

orpc.planet.create
//          ^|
```

## Next Steps

This guide introduced the RPC aspects of oRPC. To explore OpenAPI integration, visit the [OpenAPI Guide](/docs/openapi/getting-started).
