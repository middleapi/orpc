---
title: Retry After Plugin
description: A plugin for oRPC that automatically retries requests based on server Retry-After headers.
---

# Retry After Plugin

The **Retry After Plugin** automatically retries requests based on server `Retry-After` headers. This is particularly useful for handling rate limiting and temporary server unavailability.

## Usage

```ts
import { RetryAfterPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  url: 'http://localhost:3000/rpc',
  plugins: [
    new RetryAfterPlugin({
      condition: (response, options) => {
        // Override condition to determine if a request should be retried
        return response.status === 429 || response.status === 503
      },
      maxAttempts: 5, // Maximum retry attempts
      timeout: 5 * 60 * 1000, // Maximum time to spend retrying (ms)
    }),
  ],
})
```

::: info Options

- **`condition`**: A function to determine whether a request should be retried. Defaults to retrying on `429` (Too Many Requests) and `503` (Service Unavailable) status codes.
- **`maxAttempts`**: Maximum number of retry attempts allowed. Defaults to `3`.
- **`timeout`**: Maximum duration in milliseconds to spend on retries. If specified, retries will stop once this time limit is exceeded. Defaults to `5 * 60 * 1000` (5 minutes).

:::

::: info
The `link` can be any supported oRPC link, such as [RPCLink](/docs/client/rpc-link), [OpenAPILink](/docs/openapi/client/openapi-link), or custom implementations.
:::
