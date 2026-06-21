# Batch Plugin

Use the **Batch Plugin** to combine multiple requests into a single batch and receive their responses together. This reduces the overhead of sending each request separately.

::: warning
HTTP/2, HTTP/3, and later versions already support multiplexing, which allows multiple requests and responses to share a single connection. Because these protocols are now widely adopted, this plugin is often less useful than it once was.
:::

## Setup

Set up batching on both the server and the client. The server plugin handles incoming batch requests, and the client plugin groups outgoing requests into batches.

::: code-group

```ts [server.ts]
import { BatchHandlerPlugin } from '@orpc/server/plugins'

const handler = new RPCHandler(router, {
  plugins: [
    new BatchHandlerPlugin(),
  ],
})
```

```ts [client.ts]
import { BatchLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  url: '/rpc',
  plugins: [
    new BatchLinkPlugin({
      groups: [
        {
          condition: () => true,
          context: {},
        },
      ],
    }),
  ],
})
```

:::

::: warning
`BatchHandlerPlugin` detects batch requests by checking for the `orpc-batch` header. If you enable CORS, add this header to your allowlist so cross-origin batch requests are not blocked.

```ts
const cors = new CORSHandlerPlugin({
  allowHeaders: ['orpc-batch'],
})
```

:::

## Response Modes

By default, the plugin uses `streaming` mode. Responses are sent as soon as they are ready, so one slow request does not block the rest of the batch.

If your environment does not support streaming responses, such as some serverless platforms or older browsers, switch to `buffered` mode instead. In this mode, all responses are collected and sent together.

```ts
const link = new RPCLink({
  url: '/rpc',
  plugins: [
    new BatchLinkPlugin({
      mode: 'buffered',
      groups: [
        {
          condition: () => true,
          context: {},
        },
      ],
    }),
  ],
})
```

## Groups

Only requests in the same group are batched together. Each group also defines a context, as described in [client context](/docs/rpc/link#client-context).

The following example batches requests by cache policy:

```ts
interface ClientContext {
  cache?: RequestCache
}

const link = new RPCLink<ClientContext>({
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
          context: { // used for the rest of the request lifecycle
            cache: 'force-cache',
          },
        },
        { // Fallback for all other requests. Keep this last.
          condition: () => true,
          context: {},
        },
      ],
    }),
  ],
  fetch: (url, init, { context }) => globalThis.fetch(url, {
    ...init,
    cache: context?.cache,
  }),
})
```

Now, calls made with `cache = 'force-cache'` use that cache setting whether they are batched or sent individually.

## Filtering Requests

Use `filter` to skip batching for specific requests before group matching runs. Requests for which `filter` returns `false` continue through the link chain individually.

```ts
const link = new RPCLink({
  url: '/rpc',
  plugins: [
    new BatchLinkPlugin({
      filter: ({ path }) => !path.includes('upload'),
      groups: [
        {
          condition: () => true,
          context: {},
        },
      ],
    }),
  ],
})
```

## Learn More

See the [BatchHandlerPlugin source code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/batch-handler-plugin.ts) and the [BatchLinkPlugin source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/plugins/batch-link-plugin.ts) for implementation details.
