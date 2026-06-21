# Dedupe Plugin

**Dedupe Plugin** prevents redundant requests by deduplicating similar requests, reducing the number of requests sent to the server.

## Overview

```ts
import { DedupeLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  plugins: [
    new DedupeLinkPlugin({
      groups: [
        {
          condition: () => true,
          context: {}, // Context used for the rest of the request lifecycle
        },
      ],
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-link-compatibility.md -->

## Filter

By default, the plugin deduplicates only `GET` requests. You can customize this behavior by providing a `filter` function.

```ts
const link = new RPCLink({
  plugins: [
    new DedupeLinkPlugin({
      filter: ({ request }) => request.method === 'GET',
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

::: warning
If you are using [RPC Link](/docs/rpc/link), you might need to [customize the request method](/docs/rpc/link#request-method) because it defaults to `POST`.
:::

::: tip
If your application does not need to run multiple mutation requests in parallel within the same [call stack](https://developer.mozilla.org/en-US/docs/Glossary/Call_stack), you can expand the filter to deduplicate **all** request types.
This can also help prevent duplicate mutation requests when users click actions too quickly.
:::

## Groups

Only requests in the same group are deduplicated together. Each group also defines a `context`, as described in [client context](/docs/client/client-side#client-context).

The following example deduplicates requests by cache policy:

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
    new DedupeLinkPlugin({
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

Now, calls made with `cache = 'force-cache'` use that cache setting whether they are deduplicated or sent individually.

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/plugins/dedupe.ts).
