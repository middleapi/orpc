# Request Compression Plugin

Compresses request bodies before sending to the server, reducing bandwidth usage and improving performance for large payloads.

## Client

Use `RequestCompressionLinkPlugin` to compress request bodies. Configure the compression scheme and size threshold:

```ts
import { RequestCompressionLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  plugins: [
    new RequestCompressionLinkPlugin({
      /**
       * The compression scheme to use for request compression.
       * Supported values: 'gzip' | 'deflate' | 'deflate-raw'
       *
       * @default 'gzip'
       */
      encoding: 'gzip',

      /**
       * The minimum request size in bytes required to trigger compression.
       * Requests smaller than this threshold will not be compressed to avoid overhead.
       * If the request size cannot be determined, compression will still be applied.
       *
       * @default 1024 (1KB)
       */
      threshold: 1024
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-link-compatibility.md -->

## Server

Use `RequestCompressionHandlerPlugin` to decompress request bodies. The plugin automatically detects the client's compression scheme based on the [Content-Encoding header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding):

```ts [handler]
import { RequestCompressionHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new RequestCompressionHandlerPlugin(),
  ],
})
```

<!--@include: @/shared/common-plugin-handler-compatibility.md -->

::: tip
Combine with the [Request Limit Plugin](/docs/plugins/request-limit) to limit the decompressed payload size.
:::

## Learn More

For implementation details, see the [RequestCompressionLinkPlugin source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/plugins/request-compression.ts) or the [RequestCompressionHandlerPlugin source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/request-compression.ts).
