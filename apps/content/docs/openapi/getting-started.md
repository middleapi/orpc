---
title: Getting Started with OpenAPI
description: Quick guide to OpenAPI in oRPC
---

# Getting Started

OpenAPI is a widely adopted standard for describing RESTful APIs. With oRPC, you can easily publish OpenAPI-compliant APIs with minimal effort.

oRPC is inherently compatible with OpenAPI, but you may need additional configurations such as path prefixes, custom routing, or including headers, parameters, and queries in inputs and outputs. This guide explains how to make your oRPC setup fully OpenAPI-compatible. It assumes basic knowledge of oRPC or familiarity with the [Getting Started](/docs/getting-started) guide.

## Prerequisites

- Node.js 18+ (20+ recommended) | Bun | Deno | Cloudflare Workers
- A package manager: npm | pnpm | yarn | bun | deno
- A TypeScript project (strict mode recommended)

## Installation

::: code-group

```sh [npm]
npm install @orpc/server@latest @orpc/client@latest @orpc/openapi@latest
```

```sh [yarn]
yarn add @orpc/server@latest @orpc/client@latest @orpc/openapi@latest
```

```sh [pnpm]
pnpm add @orpc/server@latest @orpc/client@latest @orpc/openapi@latest
```

```sh [bun]
bun add @orpc/server@latest @orpc/client@latest @orpc/openapi@latest
```

```sh [deno]
deno add npm:@orpc/server@latest npm:@orpc/client@latest npm:@orpc/openapi@latest
```

:::

## Defining Routes

This snippet is based on the [Getting Started](/docs/getting-started) guide. Please read it first.

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
  .route({ method: 'GET', path: '/planets' })
  .input(z.object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.number().int().min(0).default(0),
  }))
  .output(z.array(PlanetSchema))
  .handler(async ({ input }) => {
    // your list code here
    return [{ id: 1, name: 'name' }]
  })

export const findPlanet = os
  .route({ method: 'GET', path: '/planets/{id}' })
  .input(z.object({ id: z.coerce.number().int().min(1) }))
  .output(PlanetSchema)
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
  .route({ method: 'POST', path: '/planets' })
  .input(PlanetSchema.omit({ id: true }))
  .output(PlanetSchema)
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

### Key Enhancements:

- `.route` defines HTTP methods and paths.
- `.output` enables automatic OpenAPI spec generation.
- `z.coerce` ensures correct parameter parsing.

For handling headers, queries, etc., see [Input/Output Structure](/docs/openapi/input-output-structure).
For auto-coercion, see [Zod Smart Coercion Plugin](/docs/openapi/plugins/zod-smart-coercion).
For more `.route` options, see [Routing](/docs/openapi/routing).

## Creating a Server

```ts twoslash
import { router } from './shared/planet'
// ---cut---
import { createServer } from 'node:http'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { CORSPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'

const handler = new OpenAPIHandler(router, {
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

### Important Changes:

- Use `OpenAPIHandler` instead of `RPCHandler`.
- Learn more in [OpenAPIHandler](/docs/openapi/openapi-handler).

## Accessing APIs

```bash
curl -X GET http://127.0.0.1:3000/planets
curl -X GET http://127.0.0.1:3000/planets/1
curl -X POST http://127.0.0.1:3000/planets \
  -H 'Authorization: Bearer token' \
  -H 'Content-Type: application/json' \
  -d '{"name": "name"}'
```

Just a small tweak makes your oRPC API OpenAPI-compliant!

## Generating OpenAPI Spec

```ts twoslash
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { router } from './shared/planet'

const generator = new OpenAPIGenerator({
  schemaConverters: [
    new ZodToJsonSchemaConverter()
  ]
})

const spec = await generator.generate(router, {
  info: {
    title: 'Planet API',
    version: '1.0.0'
  }
})

console.log(JSON.stringify(spec, null, 2))
```

Run the script above to generate your OpenAPI spec.

::: info
oRPC supports a wide range of [Standard Schema](https://github.com/standard-schema/standard-schema) for OpenAPI generation. See the full list [here](/docs/openapi/openapi-specification#generating-specifications)
:::
