---
title: Next.js Integration
description: Seamlessly integrate oRPC with Next.js
---

# Next.js Integration

[Next.js](https://nextjs.org/) is a leading React framework for server-rendered apps. oRPC works with both the [App Router](https://nextjs.org/docs/app/getting-started/installation) and [Pages Router](https://nextjs.org/docs/pages/getting-started/installation). For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

::: info
oRPC also provides out-of-the-box support for [Server Action](/docs/server-action) with no additional configuration required.
:::

## Server

You can integrate oRPC with Next.js using its [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers).

::: code-group

```ts [app/rpc/[[...rest]]/route.ts]
import { RPCHandler } from '@orpc/server/fetch'

const handler = new RPCHandler(router)

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

```ts [pages/rpc/[[...rest]].ts]
import { RPCHandler } from '@orpc/server/node'

const handler = new RPCHandler(router)

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async (req, res) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/rpc',
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

Next.js default [body parser](https://nextjs.org/docs/pages/building-your-application/routing/api-routes#custom-config) blocks oRPC raw‑request handling. Ensure `bodyParser` is disabled in your API route:

```ts
export const config = {
  api: {
    bodyParser: false,
  },
}
```

:::

## Client

Next.js doesn’t natively support isomorphic functions, so you need a workaround to make client-side code compatible with SSR. This example uses `globalThis.$headers` as that workaround. Alternatively, you can use React Context like the approach mentioned in [discussions#330](https://github.com/unnoq/orpc/discussions/330#discussioncomment-12727779).

::: code-group

```ts [lib/orpc.ts]
import type { headers } from 'next/headers'

declare global {
  var $headers: typeof headers
}

const link = new RPCLink({
  url: new URL('/rpc', typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000'),
  headers: async () => {
    return globalThis.$headers
      ? Object.fromEntries(await globalThis.$headers()) // use this on ssr
      : {} // use this on browser
  },
})
```

```ts [lib/orpc.server.ts]
'server only'

import { headers } from 'next/headers'

globalThis.$headers = headers
```

```ts [app/layout.tsx]
import '../lib/orpc.server'

// Rest of the code
```

:::

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::

## Optimize SSR

To reduce HTTP requests and improve latency during SSR, you can utilize a [Server-Side Client](/docs/client/server-side) during SSR. Below is a quick setup, see [Optimize SSR](/docs/best-practices/optimize-ssr) for a more details.

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

    return new URL('/rpc', window.location.href)
  },
})

/**
 * Fallback to client-side client if server-side client is not available.
 */
export const client: RouterClient<typeof router> = globalThis.$client ?? createORPCClient(link)
```

```ts [lib/orpc.server.ts]
'server only'

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
    headers: await headers(),
  }),
})
```

```ts [app/layout.tsx]
import '../lib/orpc.server'

// Rest of the code
```

:::
