---
title: Astro Adapter
description: Use oRPC inside an Astro project
---

# Astro Adapter

[Astro](https://astro.build/) is a JavaScript web framework optimized for building fast, content-driven websites. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

## Basic

::: code-group

```ts [pages/rpc/[...rest].ts]
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export const prerender = false

export const ALL: APIRoute = async ({ request }) => {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {},
  })

  return response ?? new Response('Not found', { status: 404 })
}
```

:::

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
