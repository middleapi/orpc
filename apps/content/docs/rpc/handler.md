# RPC Handler

Use `RPCHandler` to communicate with [RPC Link](/docs/rpc/link) and other clients that implement the [RPC protocol](/docs/rpc/protocol).

## Overview

```ts
const handler = new RPCHandler(router, {
  interceptors: [
    async ({ next, path }) => {
      console.time(path.join('.'))

      try {
        return await next()
      }
      catch (err) {
        console.error(`${path.join('.')}:`, err)
        throw err
      }
      finally {
        console.timeEnd(path.join('.'))
      }
    }
  ],
  plugins: [
    new CORSHandlerPlugin()
  ],
})
```

::: info
The actual usage of `RPCHandler` depends on the adapter you use. For example, when using the fetch adapter, the handler is used like this:

```ts
export async function fetch(request: Request) {
  const { response } = await handler.fetch(request, {
    prefix: '/rpc',
    context: {} // <- provide initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}
```

:::

<!--@include: @/shared/standard-server-cors-warning.md -->

## Interceptors

Interceptors let you observe or change different stages of an RPC request. Common use cases include logging, error handling, and metrics.

### Routing Interceptors

Routing interceptors run on every request before routing. Use them when you need to handle all requests, including requests that do not match a procedure.

```ts
const handler = new RPCHandler(router, {
  routingInterceptors: [
    async ({ next, request, context }) => {
      if (condition) {
        return { matched: false }
      }

      const { matched, response } = await next()
      return { matched, response }
    },
  ],
})
```

### Interceptors

These interceptors run only for matched requests, after routing and before error handling (but can't use `ORPCError` for [typesafe errors](/docs/error-handling#orpcerror-compatibility)). Use them when you need access to the matched procedure.

::: tip
In most cases, `interceptors` are the best choice. They provide more context, are easier to work with, and run before error handling.
:::

```ts
const handler = new RPCHandler(router, {
  interceptors: [
    async ({ next, request, procedure, context }) => {
      try {
        const response = await next()
        return response
      }
      catch (err) {
        if (err instanceof CustomError) {
          throw new ORPCError('CUSTOM_ERROR', { message: err.message, cause: err })
        }

        throw err
      }
    },
    async ({ next, path }) => {
      console.time(path.join('.'))

      try {
        const response = await next()
        return response
      }
      catch (err) {
        console.error(`${path.join('.')}:`, err)
        throw err
      }
      finally {
        console.timeEnd(path.join('.'))
      }
    },
  ],
})
```

### Client Interceptors

Client interceptors run only for matched requests, after input decoding, before output encoding and can use `ORPCError` for [typesafe errors](/docs/error-handling#orpcerror-compatibility). Use them when you need access to the procedure, input, and output.

```ts
const handler = new RPCHandler(router, {
  clientInterceptors: [
    async ({ next, input, context, procedure }) => {
      const output = await next()
      return output
    },
  ],
})
```

### Adapter Interceptors

Some `RPCHandler` implementations, such as fetch or node adapters, also support adapter interceptors. These run before [Routing Interceptors](#routing-interceptors) and let you work with the adapter's native request and response objects.

```ts
const handler = new RPCHandler(router, {
  fetchInterceptors: [
    async ({ next, request }) => {
      const { matched, response } = await next()
      return { matched, response }
    },
  ],
})
```

::: info
This example uses the fetch adapter. For other adapters, refer to their JSDoc or adapter-specific documentation.
:::

## Plugins

Plugins package reusable interceptors. For example, [CORS Plugin](/docs/plugins/cors) adds a [routing interceptor](#routing-interceptors) to handle preflight requests and adds CORS headers to every response.

```ts
const handler = new RPCHandler(router, {
  plugins: [
    new CORSHandlerPlugin()
  ],
})
```

::: info
HTTP-based `RPCHandler` implementations enable the [CSRF Guard Plugin](/docs/plugins/csrf-guard) by default to protect RPC requests from CSRF attacks. Disable it with `csrfGuardHandlerPlugin.enabled`.

```ts
const handler = new RPCHandler(router, {
  csrfGuardHandlerPlugin: {
    enabled: false,
  },
})
```

:::

## Custom Serializer

`RPCHandler` uses a built-in serializer that supports many native types. Provide a custom serializer when you need extra types or different encoding behavior. For more details, see [RPC Serializer](/docs/rpc/serializer).

```ts
const handler = new RPCHandler(router, {
  serializer: new RPCSerializer({
    handlers: {
      // ...custom handlers
    },
  }),
})
```

## Filtering Procedures

Use the `filter` option to exclude procedures from matching:

```ts
const handler = new RPCHandler(router, {
  filter: (contract, path) => getIsInternalMeta(contract) !== true,
})
```

## Custom Error Response

By default, `RPCHandler` uses `COMMON_ERROR_STATUS_MAP` to determine response status codes. Use `errorStatusMap` to customize them:

```ts
import { COMMON_ERROR_STATUS_MAP } from '@orpc/server'

const handler = new RPCHandler(router, {
  /**
   * The status code should be in the `4xx` or `5xx` range (must be greater than or equal to `400`).
   */
  errorStatusMap: {
    ...COMMON_ERROR_STATUS_MAP,
    CUSTOM_ERROR: 599,
  },
})
```

::: details Common Error Status Map

<!--@include: @/shared/common-error-status-map-table.md -->

:::

## Event Stream Options

Configure how an [AsyncIteratorObject](/docs/async-iterator-object) is streamed to the client. Available options depend on the adapter. For example, the fetch adapter supports:

```ts
const handler = new RPCHandler(router, {
  toFetchResponse: {
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
         * @default 15000
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

## Lifecycle

TODO: add lifecycle diagram
