---
title: Next.js Adapter
description: Use oRPC inside an Next.js project
---

# Next.js Adapter

[Next.js](https://nextjs.org/) is a leading React framework for server-rendered apps. oRPC works with both the [App Router](https://nextjs.org/docs/app/getting-started/installation) and [Pages Router](https://nextjs.org/docs/pages/getting-started/installation). For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

::: info
oRPC also provides out-of-the-box support for [Server Action](/docs/server-action) with no additional configuration required.
:::

## Server

You set up an oRPC server inside Next.js using its [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers).

::: code-group

```ts [app/rpc/[[...rest]]/route.ts]
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {}, // Provide initial context if needed
  })

  return response ?? new Response('Not found', { status: 404 })
}

export const HEAD = handleRequest
export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const PATCH = handleRequest
export const DELETE = handleRequest
```

:::

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::

::: details Pages Router Support?

```ts [pages/api/rpc/[[...rest]].ts]
import { RPCHandler } from '@orpc/server/node'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async (req, res) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/api/rpc',
    context: {}, // Provide initial context if needed
  })

  if (matched) {
    return
  }

  res.statusCode = 404
  res.end('Not found')
}
```

::: warning
Next.js [body parser](https://nextjs.org/docs/pages/building-your-application/routing/api-routes#custom-config) may handle common request body types, and oRPC will use the parsed body if available. However, it doesn't support features like [Bracket Notation](/docs/openapi/bracket-notation), and in case you upload a file with `application/json`, it may be parsed as plain JSON instead of a `File`. To avoid these issues, disable the body parser:

```ts
export const config = {
  api: {
    bodyParser: false,
  },
}
```

:::

## Client

By leveraging `headers` from `next/headers`, you can configure the RPC link to work seamlessly in both browser and server environments:

```ts [lib/orpc.ts]
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({
  url: `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/rpc`,
  headers: async () => {
    if (typeof window !== 'undefined') {
      return {}
    }

    const { headers } = await import('next/headers')
    return await headers()
  },
})
```

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::

## Optimize SSR

To reduce HTTP requests and improve latency during SSR, you can utilize a [Server-Side Client](/docs/client/server-side) during SSR. Below is a quick setup, see [Optimize SSR](/docs/best-practices/optimize-ssr) for more details.

::: code-group

```ts [lib/orpc.ts]
import type { RouterClient } from '@orpc/server'
import { RPCLink } from '@orpc/client/fetch'
import { createORPCClient } from '@orpc/client'

declare global {
  var $client: RouterClient<typeof router> | undefined
}

const link = new RPCLink({
  url: () => {
    if (typeof window === 'undefined') {
      throw new Error('RPCLink is not allowed on the server side.')
    }

    return `${window.location.origin}/rpc`
  },
})

/**
 * Fallback to client-side client if server-side client is not available.
 */
export const client: RouterClient<typeof router> = globalThis.$client ?? createORPCClient(link)
```

```ts [lib/orpc.server.ts]
import 'server-only'

import { headers } from 'next/headers'
import { createRouterClient } from '@orpc/server'

globalThis.$client = createRouterClient(router, {
  /**
   * Provide initial context if needed.
   *
   * Because this client instance is shared across all requests,
   * only include context that's safe to reuse globally.
   * For per-request context, use middleware context or pass a function as the initial context.
   */
  context: async () => ({
    headers: await headers(), // provide headers if initial context required
  }),
})
```

```ts [instrumentation.ts]
export async function register() {
  // Conditionally import if facing runtime compatibility issues
  // if (process.env.NEXT_RUNTIME === "nodejs") {
  await import('./lib/orpc.server')
  // }
}
```

```ts [app/layout.tsx]
import '../lib/orpc.server' // for pre-rendering

// Rest of the code
```

:::
