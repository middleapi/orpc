---
title: Solid Start Adapter
description: Use oRPC inside a Solid Start project
---

# Solid Start Adapter

[Solid Start](https://start.solidjs.com/) is a full stack JavaScript framework for building web applications with SolidJS. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

## Server

::: code-group

```ts [src/routes/rpc/[...rest].ts]
import type { APIEvent } from '@solidjs/start/server'
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

async function handle({ request }: APIEvent) {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const HEAD = handle
export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
```

```ts [src/routes/rpc/index.ts]
import { POST as handle } from './[...rest]'

export const HEAD = handle
export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
```

:::

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::

## Client

On the client, use `getRequestEvent` to provide a headers function that works seamlessly with SSR. This enables usage in both server and browser environments.

```ts
import { RPCLink } from '@orpc/client/fetch'
import { getRequestEvent } from 'solid-js/web'

const link = new RPCLink({
  url: `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/rpc`,
  headers: () => getRequestEvent()?.request.headers ?? {},
})
```

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::

## Optimize SSR

To reduce HTTP requests and improve latency during SSR, you can utilize a [Server-Side Client](/docs/client/server-side) during SSR. Below is a quick setup, see [Optimize SSR](/docs/best-practices/optimize-ssr) for more details.

::: code-group

```ts [src/lib/orpc.ts]
if (typeof window === 'undefined') {
  await import('./orpc.server')
}

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

```ts [src/lib/orpc.server.ts]
import { createRouterClient } from '@orpc/server'
import { getRequestEvent } from 'solid-js/web'

if (typeof window !== 'undefined') {
  throw new Error('This file should not be imported in the browser')
}

globalThis.$client = createRouterClient(router, {
  /**
   * Provide initial context if needed.
   *
   * Because this client instance is shared across all requests,
   * only include context that's safe to reuse globally.
   * For per-request context, use middleware context or pass a function as the initial context.
   */
  context: async () => {
    const headers = getRequestEvent()?.request.headers

    return {
      headers, // provide headers if initial context required
    }
  },
})
```

:::
