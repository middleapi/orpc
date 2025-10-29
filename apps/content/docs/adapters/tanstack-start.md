---
title: TanStack Start Adapter
description: Use oRPC inside a TanStack Start project
---

# TanStack Start Adapter

[TanStack Start](https://tanstack.com/start) is a full-stack React framework built on [Vite](https://vitejs.dev/) and the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). For additional context, see the [HTTP Adapter](/docs/adapters/http) guide.

## Server

You set up an oRPC server inside TanStack Start using its [Server Routes](https://tanstack.com/start/latest/docs/framework/react/server-routes).

::: code-group

```ts [src/routes/api/rpc.$.ts]
import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {}, // Provide initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
})
```

:::

::: info
The `handler` can be any supported oRPC handler, including [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or a custom handler.
:::

## Client

Use `createIsomorphicFn` to configure the RPC link with environment-specific settings for both browser and SSR environments:

```ts
import { RPCLink } from '@orpc/client/fetch'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

const getClientLink = createIsomorphicFn()
  .client(() => new RPCLink({
    url: `${window.location.origin}/api/rpc`,
  }))
  .server(() => new RPCLink({
    url: 'http://localhost:3000/api/rpc',
    headers: () => getRequestHeaders(),
  }))
```

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::

## Optimize SSR

To reduce HTTP requests and improve latency during SSR, you can utilize a [Server-Side Client](/docs/client/server-side) during SSR. Below is a quick setup, see [Optimize SSR](/docs/best-practices/optimize-ssr) for more details.

::: code-group

```ts [src/lib/orpc.ts]
import { createRouterClient } from '@orpc/server'
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { createIsomorphicFn } from '@tanstack/react-start'

const getORPCClient = createIsomorphicFn()
  .server(() => createRouterClient(router, {
    /**
     * Provide initial context if needed.
     *
     * Because this client instance is shared across all requests,
     * only include context that's safe to reuse globally.
     * For per-request context, use middleware context or pass a function as the initial context.
     */
    context: async () => ({
      headers: getRequestHeaders(), // provide headers if initial context required
    }),
  }))
  .client((): RouterClient<typeof router> => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
    })

    return createORPCClient(link)
  })

export const client: RouterClient<typeof router> = getORPCClient()
```

:::
