# Request Limit Plugin

Restricts the size of incoming request bodies to protect the server from oversized payloads.

## Setup

Use `RequestLimitHandlerPlugin` to limit the size of incoming request bodies.

```ts
import { RequestLimitHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new RequestLimitHandlerPlugin({
      /**
       * The maximum allowed request body size in bytes.
       */
      maxBodySize: 1024 * 1024, // 1MB
    }),
  ],
})
```

<!--@include: @/shared/any-handler-support-info.md -->

::: info
When used with [Request Compression](/docs/plugins/request-compression), `maxBodySize` applies to the **decompressed** payload size, not the compressed wire size.
:::

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/request-limit.ts).
