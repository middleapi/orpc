# Response Compression Plugin

Compresses response bodies to reduce bandwidth usage and improve performance for clients that support compression.

## Server

Use `ResponseCompressionHandlerPlugin` to compress response bodies. The plugin selects an encoding based on [Accept-Encoding header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Encoding):

```ts [handler]
import { ResponseCompressionHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new ResponseCompressionHandlerPlugin({
      /**
       * The compression schemes to use for response compression.
       * Schemes are prioritized by their order in this array and
       * only applied if the client supports them.
       * Supported values: 'gzip' | 'deflate' | 'deflate-raw'
       *
       * @default ['gzip', 'deflate']
       */
      encodings: ['gzip', 'deflate'],

      /**
       * The minimum response size in bytes required to trigger compression.
       * Responses smaller than this threshold will not be compressed to avoid overhead.
       * If the response size cannot be determined, compression will still be applied.
       *
       * @default 1024 (1KB)
       */
      threshold: 1024,
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-handler-compatibility.md -->

## Client

Use `ResponseCompressionLinkPlugin` to advertise supported encodings via [Accept-Encoding header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Encoding) and automatically decompress response bodies based on the [Content-Encoding header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding):

```ts
import { ResponseCompressionLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  plugins: [
    new ResponseCompressionLinkPlugin({
      /**
       * Compression schemes to advertise via Accept-Encoding, in preference order.
       * Supported values: 'gzip' | 'deflate' | 'deflate-raw'
       *
       * @default ['gzip', 'deflate']
       */
      encodings: ['gzip', 'deflate'],
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-link-compatibility.md -->

::: warning
When using the fetch adapter, this plugin is usually unnecessary because most fetch implementations automatically decompress responses based on the `Content-Encoding` header.
:::

## Learn More

For implementation details, see the [ResponseCompressionLinkPlugin source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/plugins/response-compression.ts) or the [ResponseCompressionHandlerPlugin source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/response-compression.ts).
