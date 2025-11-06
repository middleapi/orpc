---
title: Client Retry Plugin
description: A plugin for oRPC that enables retrying client calls when errors occur.
---

# Client Retry Plugin

The `Client Retry Plugin` enables retrying client calls when errors occur.

## Setup

Before you begin, please review the [Client Context](/docs/client/rpc-link#using-client-context) documentation.

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
// ---cut---
import { RPCLink } from '@orpc/client/fetch'
import { ClientRetryPlugin, ClientRetryPluginContext } from '@orpc/client/plugins'

interface ORPCClientContext extends ClientRetryPluginContext {}

const link = new RPCLink<ORPCClientContext>({
  url: 'http://localhost:3000/rpc',
  plugins: [
    new ClientRetryPlugin({
      default: { // Optional override for default options
        retry: ({ path }) => {
          if (path.join('.') === 'planet.list') {
            return 2
          }

          return 0
        }
      },
    }),
  ],
})

const client: RouterClient<typeof router, ORPCClientContext> = createORPCClient(link)
```

::: info
The `link` can be any supported oRPC link, such as [RPCLink](/docs/client/rpc-link), [OpenAPILink](/docs/openapi/client/openapi-link), or custom implementations.
:::

## Usage

```ts twoslash
import { router } from './shared/planet'
import { ClientRetryPluginContext } from '@orpc/client/plugins'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router, ClientRetryPluginContext>
// ---cut---
const planets = await client.planet.list({ limit: 10 }, {
  context: {
    retry: 3, // Maximum retry attempts
    retryDelay: 2000, // Delay between retries in ms
    retryTimeout: 30000, // Maximum time to spend retrying (in ms)
    shouldRetry: options => true, // Determines whether to retry based on the error
    onRetry: (options) => {
      // Hook executed on each retry

      return (isSuccess) => {
        // Execute after the retry is complete
      }
    },
  }
})
```

::: info
By default, retries are disabled unless a `retry` count is explicitly set.

- **retry:** Maximum retry attempts before throwing an error (default: `0`).
- **retryDelay:** Delay between retries in milliseconds. If the error response includes a `Retry-After` header, it will be used automatically (default: `(o) => o.retryAfter ?? o.lastEventRetry ?? 2000`).
- **retryTimeout:** Maximum time in milliseconds to spend retrying before giving up. If undefined, no timeout is enforced (default: `undefined`).
- **shouldRetry:** Function that determines whether to retry based on the error (default: `true`).
- **onRetry:** Hook executed on each retry that can return a cleanup function.
  :::

## Retry-After Header Support

The retry plugin automatically detects and respects the `Retry-After` HTTP header in error responses. This header can contain either:

- A delay in seconds (e.g., `"120"`)
- An HTTP date (e.g., `"Wed, 21 Oct 2015 07:28:00 GMT"`)

When the `Retry-After` header is present in an error response (e.g., 429 Too Many Requests, 503 Service Unavailable), the plugin will automatically use that value as the retry delay instead of the default.

```ts twoslash
import { router } from './shared/planet'
import { ClientRetryPluginContext } from '@orpc/client/plugins'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router, ClientRetryPluginContext>
// ---cut---
// The retry delay will be automatically extracted from the Retry-After header
const result = await client.rateLimit.check({}, {
  context: {
    retry: 5, // Will retry up to 5 times
    // retryDelay is optional - Retry-After header will be used if present
  }
})
```

You can still provide a custom `retryDelay` function to override the `Retry-After` header if needed:

```ts twoslash
import { router } from './shared/planet'
import { ClientRetryPluginContext } from '@orpc/client/plugins'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router, ClientRetryPluginContext>
// ---cut---
const result = await client.rateLimit.check({}, {
  context: {
    retry: 5,
    retryDelay: 1000, // Always use 1 second, ignoring Retry-After header
  }
})
```

## Retry Timeout

The `retryTimeout` option allows you to limit the total time spent retrying. This is useful to prevent excessive delays when handling rate limits or service unavailability.

```ts twoslash
import { router } from './shared/planet'
import { ClientRetryPluginContext } from '@orpc/client/plugins'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router, ClientRetryPluginContext>
// ---cut---
const result = await client.slowService.call({}, {
  context: {
    retry: 10, // Up to 10 retries
    retryDelay: 5000, // 5 seconds between retries
    retryTimeout: 30000, // But stop after 30 seconds total
  }
})
```

::: warning
The retry timeout is checked before each retry attempt. If the elapsed time plus the next retry delay would exceed the timeout, the retry is skipped and the error is thrown immediately.
:::

## Event Iterator (SSE)

To replicate the behavior of [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) for [Event Iterator](/docs/event-iterator), use the following configuration:

```ts
const streaming = await client.streaming('the input', {
  context: {
    retry: Number.POSITIVE_INFINITY,
  }
})

for await (const message of streaming) {
  console.log(message)
}
```
