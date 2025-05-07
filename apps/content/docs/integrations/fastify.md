---
title: Fastify Integration
description: Seamlessly integrate oRPC with Fastify
---

# Fastify Integration

[Fastify](https://fastify.dev/) is a web framework highly focused on providing the best developer experience with the least overhead and a powerful plugin architecture. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

::: warning
Fastify automatically parses the request payload which interferes with oRPC, that apply its own parser. To avoid errors, it's necessary to create a node http server and pass the requests to oRPC first, and if there's no match, pass it to Fastify.
:::

## Basic

```ts
import { createServer } from 'node:http'
import Fastify from 'fastify'
import { RPCHandler } from '@orpc/server/node'
import { CORSPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin()
  ]
})

const fastify = Fastify({
  logger: true,
  serverFactory: (fastifyHandler) => {
    const server = createServer(async (req, res) => {
      const { matched } = await handler.handle(req, res, {
        context: {},
        prefix: '/rpc',
      })

      if (matched) {
        return
      }

      fastifyHandler(req, res)
    })

    return server
  },
})

try {
  await fastify.listen({ port: 3000 })
}
catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
