---
title: Elysia Adapter
description: Use oRPC inside an Elysia project
---

# Elysia Adapter

[Elysia](https://elysiajs.com/) is a high-performance web framework for [Bun](https://bun.sh/) that adheres to the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

## Basic

```ts
import { Elysia } from 'elysia'
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

const app = new Elysia()
  .all('/rpc*', async ({ request }: { request: Request }) => {
    const { response } = await handler.handle(request, {
      prefix: '/rpc',
    })

    return response ?? new Response('Not Found', { status: 404 })
  }, {
    parse: 'none' // Disable Elysia body parser to prevent "body already used" error
  })
  .listen(3000)

console.log(
  `🦊 Elysia is running at http://localhost:3000`
)
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
