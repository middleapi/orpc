---
title: Batch Requests Plugin
description: A plugin for oRPC to batch requests and responses.
---

# Batch Requests Plugin

The **Batch Requests Plugin** allows you to combine multiple requests and responses into a single batch, reducing the overhead of sending each one separately.

## Setup

This plugin requires configuration on both the server and client sides.

### Server

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
import { router } from './shared/planet'
// ---cut---
import { BatchHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [new BatchHandlerPlugin()],
})
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler) or custom implementations. Note that this plugin uses its own protocol for batching requests and responses, which is different from the handler's native protocol.
:::

### Client

To use the `BatchLinkPlugin`, define at least one group. Requests within the same group will be considered for batching together, and each group requires a `context` as described in [client context](/docs/client/rpc-link#using-client-context).

```ts twoslash
import { RPCLink } from '@orpc/client/fetch'
// ---cut---
import { BatchLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  url: 'https://api.example.com/rpc',
  plugins: [
    new BatchLinkPlugin({
      groups: [
        {
          condition: options => true,
          context: {} // Context used for the rest of the request lifecycle
        }
      ]
    }),
  ],
})
```

::: info
The `link` can be any supported oRPC link, such as [RPCLink](/docs/client/rpc-link), [OpenAPILink](/docs/openapi/client/openapi-link), or custom implementations.
:::

## Batch Mode

By default, the plugin uses `streaming` mode, which sends responses asynchronously as they arrive. This ensures that no single request blocks others, allowing for faster and more efficient batching.

If your environment does not support streaming responses, such as some serverless platforms or older browsers you can switch to `buffered` mode. In this mode, all responses are collected before being sent together.

```ts
const link = new RPCLink({
  url: 'https://api.example.com/rpc',
  plugins: [
    new BatchLinkPlugin({
      mode: typeof window === 'undefined' ? 'buffered' : 'streaming', // [!code highlight]
      groups: [
        {
          condition: options => true,
          context: {}
        }
      ]
    }),
  ],
})
```

## Limitations

The plugin does not support [AsyncIteratorObject](/docs/rpc-handler#supported-data-types) or [File/Blob](/docs/rpc-handler#supported-data-types) in responses (requests will auto fall back to the default behavior). To exclude unsupported procedures, use the `exclude` option:

```ts twoslash
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'
// ---cut---
const link = new RPCLink({
  url: 'https://api.example.com/rpc',
  plugins: [
    new BatchLinkPlugin({
      groups: [
        {
          condition: options => true,
          context: {}
        }
      ],
      exclude: ({ path }) => {
        return ['planets/getImage', 'planets/subscribe'].includes(path.join('/'))
      }
    }),
  ],
})
```

## Request Headers

By default, oRPC uses the headers appear in all requests in the batch. To customize headers, use the `headers` option:

```ts twoslash
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'
// ---cut---
const link = new RPCLink({
  url: 'https://api.example.com/rpc',
  plugins: [
    new BatchLinkPlugin({
      groups: [
        {
          condition: options => true,
          context: {}
        }
      ],
      headers: () => ({
        authorization: 'Bearer 1234567890',
      })
    }),
  ],
})
```

## Response Headers

By default, the response headers are empty. To customize headers, use the `headers` option:

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
import { router } from './shared/planet'
// ---cut---
import { BatchHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [new BatchHandlerPlugin({
    headers: responses => ({
      'some-header': 'some-value',
    })
  })],
})
```

## Groups

Requests within the same group will be considered for batching together, and each group requires a `context` as described in [client context](/docs/client/rpc-link#using-client-context).

In the example below, I used a group and `context` to batch requests based on the `cache` control:

```ts twoslash
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'

interface ClientContext {
  cache?: RequestCache
}

const link = new RPCLink<ClientContext>({
  url: 'http://localhost:3000/rpc',
  method: ({ context }) => {
    if (context?.cache) {
      return 'GET'
    }

    return 'POST'
  },
  plugins: [
    new BatchLinkPlugin({
      groups: [
        {
          condition: ({ context }) => context?.cache === 'force-cache',
          context: { // This context will be passed to the fetch method
            cache: 'force-cache',
          },
        },
        { // Fallback for all other requests - need put it at the end of list
          condition: () => true,
          context: {},
        },
      ],
    }),
  ],
  fetch: (request, init, { context }) => globalThis.fetch(request, {
    ...init,
    cache: context?.cache,
  }),
})
```

Now, calls with `cache=force-cache` will be sent with `cache=force-cache`, whether they're batched or executed individually.
