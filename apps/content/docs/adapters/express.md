---
title: Express.js Adapter
description: Use oRPC inside an Express.js project
---

# Express.js Adapter

[Express.js](https://expressjs.com/) is a popular Node.js framework for building web applications. For additional context, refer to the [HTTP Adapter](/docs/adapters/http) guide.

::: warning
Express's [body-parser](https://expressjs.com/en/resources/middleware/body-parser.html) handles common request body types, and oRPC will use the parsed body if available. However, it doesn't support features like [Bracket Notation](/docs/openapi/bracket-notation), and in case you upload a file with `application/json`, it may be parsed as plain JSON instead of a `File`. To avoid these issues, register any body-parsing middleware **after** your oRPC middleware or only on routes that don't use oRPC.
:::

## Basic

```ts
import express from 'express'
import cors from 'cors'
import { RPCHandler } from '@orpc/server/node'
import { onError } from '@orpc/server'

const app = express()

app.use(cors())

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

app.use('/rpc{/*path}', async (req, res, next) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/rpc',
    context: {},
  })

  if (matched) {
    return
  }

  next()
})

app.listen(3000, () => console.log('Server listening on port 3000'))
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
