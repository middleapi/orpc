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
- **retryDelay:** Delay between retries (default: `(o) => o.lastEventRetry ?? 2000`).
- **shouldRetry:** Function that determines whether to retry (default: `true`).
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
