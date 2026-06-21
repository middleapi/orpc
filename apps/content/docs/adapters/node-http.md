# Node HTTP Adapter

oRPC supports [Node HTTP](https://nodejs.org/api/http.html), [Node HTTPS](https://nodejs.org/api/https.html), and [Node HTTP2](https://nodejs.org/api/http2.html) for servers.

## Server Usage

::: code-group

```ts [RPC]
import { createServer } from 'node:http' // or 'node:https' or 'node:http2'
import { RPCHandler } from '@orpc/server/node'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSHandlerPlugin()
  ],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
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

```ts [OpenAPI]
import { createServer } from 'node:http' // or 'node:https' or 'node:http2'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'

const handler = new OpenAPIHandler(router, {
  plugins: [
    new CORSHandlerPlugin()
  ],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

const server = createServer(async (req, res) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/api',
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

:::

<!--@include: @/shared/standard-server-cors-warning.md -->

## Event Stream Options

You can configure how [event iterators](/docs/event-iterator) are streamed to the client using the `sendStandardResponse.eventStream` options when creating the handler.

```ts
const handler = new OpenAPIHandler(router, {
  sendStandardResponse: {
    eventStream: {
      initialComment: {
        /**
         * If true, an initial comment is sent immediately upon stream start to flush headers.
         * This allows the receiving side to establish the connection without waiting for the first event.
         *
         * @default true
         */
        enabled: true,
        /**
         * The content of the initial comment sent upon stream start. Must not include newline characters.
         *
         * @default ''
         */
        comment: '',
      },
      keepAlive: {
        /**
         * If true, a ping comment is sent periodically to keep the connection alive.
         *
         * @default true
         */
        enabled: true,
        /**
         * Interval (in milliseconds) between ping comments sent after the last event.
         *
         * @default 5000
         */
        interval: 5000,
        /**
         * The content of the ping comment. Must not include newline characters.
         *
         * @default ''
         */
        comment: '',
      },
      /**
       * If true, a `close` event is sent even when the iterator completes with `undefined`.
       * When the iterator returns a value, a `close` event is always emitted regardless of this setting.
       *
       * @default true
       */
      emptyCloseEventEnabled: true,
    },
  },
})
```
