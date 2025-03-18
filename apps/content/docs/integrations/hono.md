---
title: Hono Integration
description: Integrate oRPC with Hono
---

# Hono Integration

[Hono](https://honojs.dev/) is a high-performance web framework built on top of [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). For additional context, refer to the [Fetch Server Integration](/docs/integrations/fetch-server) guide.

## Basic

```ts
import { Hono } from 'hono'
import { createMiddleware, RPCHandler } from '@orpc/server/hono'

const app = new Hono()

const handler = new RPCHandler(router)

app.use('/rpc/*', createMiddleware(handler, {
  prefix: '/rpc',
  context: async (c) => {
    return {} // Provide initial context if needed
  }
}))

export default app
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
