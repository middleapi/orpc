# CORS Handler Plugin

Use `CORSHandlerPlugin` to configure [CORS Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) for your API.

## Basic

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
// ---cut---
import { CORSHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSHandlerPlugin({
      origin: (origin, options) => origin,
      allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
      // ...
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-handler-compatibility.md -->

<!--@include: @/shared/standard-server-cors-warning.md -->

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/cors.ts).
