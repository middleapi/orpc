# Rethrow Handler Plugin

`RethrowHandlerPlugin` can bypass oRPC's built-in error handling and rethrow matching errors directly to your framework's error handling mechanism (e.g., NestJS exception filters, Express error middleware).

## Usage

```ts
import { RethrowHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new RethrowHandlerPlugin({
      filter: (error, options) => {
        // Example: Rethrow all non-ORPCError errors
        return !(error instanceof ORPCError)
      },
    }),
  ],
})

try {
  await handler.handle(request)
}
catch (error) {
  // If the filter returns true, the error can be caught here
}
```

<!--@include: @/shared/any-handler-support-info.md -->
