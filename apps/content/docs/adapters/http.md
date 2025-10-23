---
title: HTTP
description: How to use oRPC over HTTP?
---

# HTTP

oRPC includes built-in HTTP support, making it easy to expose RPC endpoints in any environment that speaks HTTP.

## Server Adapters

| Adapter      | Target                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `fetch`      | [MDN Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) (Browser, Bun, Deno, Cloudflare Workers, etc.) |
| `node`       | Node.js built-in [`http`](https://nodejs.org/api/http.html)/[`http2`](https://nodejs.org/api/http2.html)                   |
| `fastify`    | [Fastify](https://fastify.dev/)                                                                                            |
| `aws-lambda` | [AWS Lambda](https://aws.amazon.com/lambda/)                                                                               |

::: code-group

```ts [node]
import { createServer } from 'node:http' // or 'node:http2'
import { RPCHandler } from '@orpc/server/node'
import { CORSPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin()
  ]
})

const server = createServer(async (req, res) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  if (matched) {
    return
  }

  res.statusCode = 404
  res.end('Not found')
})

server.listen(3000, '127.0.0.1', () => console.log('Listening on 127.0.0.1:3000'))
```

```ts [bun]
import { RPCHandler } from '@orpc/server/fetch'
import { CORSPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin()
  ]
})

Bun.serve({
  async fetch(request: Request) {
    const { matched, response } = await handler.handle(request, {
      prefix: '/rpc',
      context: {} // Provide initial context if needed
    })

    if (matched) {
      return response
    }

    return new Response('Not found', { status: 404 })
  }
})
```

```ts [cloudflare]
import { RPCHandler } from '@orpc/server/fetch'
import { CORSPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin()
  ]
})

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const { matched, response } = await handler.handle(request, {
      prefix: '/rpc',
      context: {} // Provide initial context if needed
    })

    if (matched) {
      return response
    }

    return new Response('Not found', { status: 404 })
  }
}
```

```ts [deno]
import { RPCHandler } from '@orpc/server/fetch'
import { CORSPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin()
  ]
})

Deno.serve(async (request) => {
  const { matched, response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  if (matched) {
    return response
  }

  return new Response('Not found', { status: 404 })
})
```

```ts [fastify]
import Fastify from 'fastify'
import { RPCHandler } from '@orpc/server/fastify'

const rpcHandler = new RPCHandler(router)

const fastify = Fastify()

fastify.addContentTypeParser('*', (request, payload, done) => {
  // Fully utilize oRPC feature by allowing any content type
  // And let oRPC parse the body manually by passing `undefined`
  done(null, undefined)
})

fastify.all('/rpc/*', async (req, reply) => {
  const { matched } = await rpcHandler.handle(req, reply, {
    prefix: '/rpc',
  })

  if (!matched) {
    reply.status(404).send('Not found')
  }
})

fastify.listen({ port: 3000 }).then(() => console.log('Listening on 127.0.0.1:3000'))
```

```ts [aws-lambda]
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { RPCHandler } from '@orpc/server/aws-lambda'

const rpcHandler = new RPCHandler(router)

/**
 * oRPC only supports [AWS Lambda response streaming](https://aws.amazon.com/blogs/compute/introducing-aws-lambda-response-streaming/).
 * If you need support chunked responses, use a combination of Hono's `aws-lambda` adapter and oRPC.
 */
export const handler = awslambda.streamifyResponse<APIGatewayProxyEventV2>(async (event, responseStream, context) => {
  const { matched } = await rpcHandler.handle(event, responseStream, {
    prefix: '/rpc',
    context: {} // Provide initial context if needed
  })

  if (matched) {
    return
  }

  awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 404,
  })

  responseStream.write('Not found')
  responseStream.end()
})
```

:::

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::

## Client Adapters

| Adapter | Target                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `fetch` | [MDN Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) (Browser, Node, Bun, Deno, Cloudflare Workers, etc.) |

```ts
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({
  url: 'http://localhost:3000/rpc',
  headers: () => ({
    'x-api-key': 'my-api-key'
  }),
  // fetch: <-- polyfill fetch if needed
})
```

::: info
The `link` can be any supported oRPC link, such as [RPCLink](/docs/client/rpc-link), [OpenAPILink](/docs/openapi/client/openapi-link), or another custom handler.
:::

::: info
This only shows how to configure the http link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::
