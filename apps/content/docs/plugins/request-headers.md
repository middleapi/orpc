# Request Headers Plugin

Use `RequestHeadersHandlerPlugin` to expose incoming request headers as `context.reqHeaders`.

## Context Access

```ts twoslash
import { os } from '@orpc/server'
// ---cut---
import { getCookie } from '@orpc/server/helpers'
import type { RequestHeadersHandlerPluginContext } from '@orpc/server/plugins'

interface ServerContext extends RequestHeadersHandlerPluginContext {}

const base = os.$context<ServerContext>()

const example = base
  .use(({ context, next }) => {
    const sessionId = getCookie(context.reqHeaders, 'session_id')
    return next()
  })
  .handler(({ context }) => {
    const userAgent = context.reqHeaders?.get('user-agent')
    return { userAgent }
  })
```

::: info Why can `reqHeaders` be undefined?
This allows procedures to run safely even without `RequestHeadersHandlerPlugin`, such as in direct calls.
:::

::: tip
Combine with [Cookie Helpers](/docs/helpers/cookie) for streamlined cookie management.
:::

## Handler Setup

```ts
import { RequestHeadersHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new RequestHeadersHandlerPlugin(),
  ],
})
```

<!--@include: @/shared/any-handler-support-info.md -->

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/request-headers.ts).
