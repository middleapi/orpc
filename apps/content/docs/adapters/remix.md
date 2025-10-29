---
title: Remix Adapter
description: Use oRPC inside an Remix project
---

# Remix Adapter

[Remix](https://remix.run/) is a full stack JavaScript framework for building web applications with React. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

## Basic

```ts [app/routes/rpc.$.ts]
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export async function loader({ request }: LoaderFunctionArgs) {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
