---
title: TanStack Start Integration
description: Integrate oRPC with TanStack Start
---

# TanStack Start Integration

[TanStack Start](https://tanstack.com/start) is a full-stack React framework built on [Nitro](https://nitro.dev/) and the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). For additional context, see the [Fetch Server Integration](/docs/integrations/fetch-server) guide.

## Server

You can integrate oRPC handlers with TanStack Start using its [API Routes](https://tanstack.com/start/latest/docs/framework/react/api-routes).

::: code-group

```ts [app/routes/api/rpc.$.ts]
import { RPCHandler } from '@orpc/server/fetch'
import { createAPIFileRoute } from '@tanstack/start/api'

const handler = new RPCHandler(router)

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {} // Provide initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const APIRoute = createAPIFileRoute('/api/rpc/$')({
  GET: handle,
  POST: handle,
  PUT: handle,
  PATCH: handle,
  DELETE: handle,
})
```

```ts [app/routes/api/rpc.ts]
import { createAPIFileRoute } from '@tanstack/start/api'
import { APIRoute as BaseAPIRoute } from './rpc.$'

export const APIRoute = createAPIFileRoute('/api/rpc')(BaseAPIRoute.methods)
```

:::

::: info
The `handler` can be any supported oRPC handler, including [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or a custom handler.
:::

Alternatively, you can use any other supported server integration for your oRPC handlers while using TanStack Start solely for client-side functionality.

## Client

Once you've set up the client following the [Client-Side Clients](/docs/client/client-side) guide, you can use it directly in your TanStack Start [Routes](https://tanstack.com/start/latest/docs/framework/react/learn-the-basics#routes) for both data fetching and mutations:

::: code-group

```tsx [src/routes/index.tsx]
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { client } from '@/lib/client'

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => {
    return await client.counter.get()
  },
})

function Home() {
  const router = useRouter()
  const state = Route.useLoaderData()
  const updateCount = async () => {
    await client.counter.increment()
    router.invalidate()
  }
  return (
    <div>
      <div>{state.value}</div>
      <button type="button" onClick={updateCount}>
        Increment
      </button>
    </div>
  )
}
```

```ts [src/lib/contract.ts]
import { oc } from '@orpc/contract'
import { z } from 'zod'

export const Count = z.object({
  value: z.number().int().min(0),
  updatedAt: z.date(),
})

export const incrementCountContract = oc
  .route({ method: 'POST', path: '/count:increment' })
  .output(Count)

export const getCountContract = oc
  .route({ method: 'GET', path: '/count' })
  .output(Count)

export const contract = {
  counter: { increment: incrementCountContract, get: getCountContract },
}
```

:::

::: info
In this example, the oRPC client provides functionality similar to TanStack Start's [Server Functions](https://tanstack.com/start/latest/docs/framework/react/server-functions).
:::

## SSR

During server-side rendering, the server (not the browser) calls the route loader. When your handlers require browser headers or cookies, you'll need to forward them to the oRPC client using the `headers` option and the `getHeaders` function from TanStack Start.

If your handlers run on a separate server or if you're comfortable with multiple network requests, you can reuse your client-side client instance:

```ts [src/lib/client.ts]
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { ContractRouterClient } from '@orpc/contract'
import { getHeaders } from '@tanstack/react-start/server'
import { contract } from '@/lib/contract'

export const link = new RPCLink({
  url: 'http://localhost:8080/rpc',
  headers: () => {
    // For server-side rendering
    if (typeof window === 'undefined') {
      return getHeaders()
    }
    // For client-side rendering
    return {}
  },
})

export const api: ContractRouterClient<typeof contract> = createORPCClient(link)
```

Alternatively, you can create an isomorphic client by combining both the [Client-Side Client](/docs/client/client-side.md) and [Server-Side Client](/docs/client/server-side.md) approaches.
