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

## Learn More

For implementation details, see the [fetch adapter source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/fetch/body-compression-plugin.ts) and the [node adapter source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/node/body-compression-plugin.ts).
