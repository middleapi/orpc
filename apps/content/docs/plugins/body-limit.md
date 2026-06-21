# Body Limit Plugin

**Body Limit Plugin** helps restrict the size of the request body.

## Import

Depending on your adapter, import the corresponding plugin:

```ts
import { BodyLimitHandlerPlugin } from '@orpc/server/fetch'
import { BodyLimitHandlerPlugin } from '@orpc/server/node'
```

## Setup

Set `maxBodySize` to the maximum number of bytes allowed:

```ts
const handler = new RPCHandler(router, {
  plugins: [
    new BodyLimitHandlerPlugin({
      maxBodySize: 1024 * 1024, // 1MB
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-handler-compatibility.md -->

## Learn More

For implementation details, see the [fetch adapter source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/fetch/body-limit-plugin.ts) and the [node adapter source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/node/body-limit-plugin.ts).
