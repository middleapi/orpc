# Body Compression Plugin

**Body Compression Plugin** compresses response bodies to reduce bandwidth usage and improve performance for clients that support compression.

## Import

Depending on your adapter, import the corresponding plugin:

```ts
import { BodyCompressionHandlerPlugin } from '@orpc/server/node'
import { BodyCompressionHandlerPlugin } from '@orpc/server/fetch'
```

## Setup

Add the plugin to your handler:

```ts
const handler = new RPCHandler(router, {
  plugins: [
    new BodyCompressionHandlerPlugin(),
  ],
})
```

<!--@include: @/shared/common-plugin-handler-compatibility.md -->

## Batch and Event Stream Responses

Event stream responses are never compressed: the web `CompressionStream` API cannot flush between chunks, so early events would sit in the compressor buffer until the stream ends, defeating streaming semantics.

[Batch requests](/docs/plugins/batch-requests) (identified by the `orpc-batch` header) with an `application/octet-stream` body are compressed by the fetch adapter when the runtime exposes the Node.js `zlib` and `stream` builtins via `process.getBuiltinModule` (Node.js ≥ 22.3, Bun, and compatible runtimes): a flush-per-message `zlib` stream is used instead of `CompressionStream`, so each response in a streaming batch is delivered to the client as soon as it is ready — compressed. In runtimes without these builtins, such batch responses stay uncompressed.

## Learn More

For implementation details, see the [fetch adapter source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/fetch/body-compression-plugin.ts) and the [node adapter source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/node/body-compression-plugin.ts).
