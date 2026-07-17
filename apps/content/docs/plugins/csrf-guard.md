# CSRF Guard Plugin

Use `CSRFGuardHandlerPlugin` to protect against [Cross-Site Request Forgery (CSRF) attacks](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF) by rejecting requests with unsafe fetch modes.

## How It Works

The plugin inspects the [Sec-Fetch-Mode header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-Fetch-Mode) and blocks requests with a mode of `navigate`, `no-cors`, or `websocket`, which may be triggered by cross-site links, forms, or other passive browser features.

## Setup

```ts
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { CSRFGuardHandlerPlugin } from '@orpc/server/plugins'

const handler = new OpenAPIHandler(router, {
  plugins: [
    new CSRFGuardHandlerPlugin(),
  ],
})
```

::: info
HTTP-based `RPCHandler` implementations enable this plugin by default. Disable it with `csrfGuardHandlerPlugin.enabled`.

```ts
const handler = new RPCHandler(router, {
  csrfGuardHandlerPlugin: {
    enabled: false,
  },
})
```

:::

<!--@include: @/shared/any-handler-support-info.md -->

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/csrf-guard.ts).
