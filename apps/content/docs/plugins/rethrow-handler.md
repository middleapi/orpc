---
title: Rethrow Handler Plugin
description: A plugin to catch and rethrow specific errors during request handling instead of handling them in the oRPC error flow.
---

# Rethrow Handler Plugin

The `RethrowHandlerPlugin` allows you to catch and rethrow specific errors that occur during request handling. This is particularly useful when your framework has its own error handling mechanism (e.g., global exception filters in NestJS, error middleware in Express) and you want certain errors to be processed by that mechanism instead of being handled by the oRPC error handling flow.

## Usage

```ts twoslash
import { ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { router } from './shared/planet'

// ---cut---
import {
  experimental_RethrowHandlerPlugin as RethrowHandlerPlugin,
} from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new RethrowHandlerPlugin({
      // Decide which errors should be rethrown.
      filter: (error) => {
        // Example: Rethrow all non-ORPCError errors
        // This allows unhandled exceptions to bubble up to your framework
        return !(error instanceof ORPCError)
      },
    }),
  ],
})
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::
