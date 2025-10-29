---
title: Svelte Kit Adapter
description: Use oRPC inside an Svelte Kit project
---

# Svelte Kit Adapter

[Svelte Kit](https://svelte.dev/docs/kit/introduction) is a framework for rapidly developing robust, performant web applications using Svelte. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

## Server

::: code-group

```ts [src/routes/rpc/[...rest]/+server.ts]
import { error } from '@sveltejs/kit'
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

const handle: RequestHandler = async ({ request }) => {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}

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

## Optimize SSR

To reduce HTTP requests and improve latency during SSR, you can utilize [Svelte's special `fetch`](https://svelte.dev/docs/kit/web-standards#Fetch-APIs) during SSR. Below is a quick setup, see [Optimize SSR](/docs/best-practices/optimize-ssr) for more details.

::: code-group

```ts [src/lib/orpc.ts]
import type { RouterClient } from '@orpc/server'
import { RPCLink } from '@orpc/client/fetch'
import { createORPCClient } from '@orpc/client'

declare global {
  var $client: RouterClient<typeof router> | undefined
}

const link = new RPCLink({
  url: () => {
    if (typeof window === 'undefined') {
      throw new Error('This link is not allowed on the server side.')
    }

    return `${window.location.origin}/rpc`
  },
})

export const client: RouterClient<typeof router> = globalThis.$client ?? createORPCClient(link)
```

```ts [src/lib/orpc.server.ts]
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { getRequestEvent } from '$app/server'

if (typeof window !== 'undefined') {
  throw new Error('This file should only be imported on the server')
}

const link = new RPCLink({
  url: async () => {
    return `${getRequestEvent().url.origin}/rpc`
  },
  async fetch(request, init) {
    return getRequestEvent().fetch(request, init)
  },
})

const serverClient: RouterClient<typeof router> = createORPCClient(link)
globalThis.$client = serverClient
```

```ts [src/hooks.server.ts]
import './lib/orpc.server'
// ...
```

:::
