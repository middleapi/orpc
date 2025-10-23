---
title: Fastify Adapter
description: Use oRPC inside an Fastify project
---

# Fastify Adapter

[Fastify](https://fastify.dev/) is a web framework highly focused on providing the best developer experience with the least overhead and a powerful plugin architecture. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

::: warning
Fastify parses common request content types by default. oRPC will use the parsed body when available.
:::

## Basic

```ts
import Fastify from 'fastify'
import { RPCHandler } from '@orpc/server/fastify'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ]
})

const fastify = Fastify()

fastify.addContentTypeParser('*', (request, payload, done) => {
  // Fully utilize oRPC feature by allowing any content type
  // And let oRPC parse the body manually by passing `undefined`
  done(null, undefined)
})

fastify.all('/rpc/*', async (req, reply) => {
  const { matched } = await handler.handle(req, reply, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  if (!matched) {
    reply.status(404).send('Not found')
  }
})

fastify.listen({ port: 3000 }).then(() => console.log('Server running on http://localhost:3000'))
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
