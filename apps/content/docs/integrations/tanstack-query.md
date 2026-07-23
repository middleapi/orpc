# TanStack Query Integration

[TanStack Query](https://tanstack.com/query/latest) integration provides utilities for using oRPC clients with TanStack Query. It includes helper methods for building query and mutation options, as well as query and mutation keys.

::: warning
This guide assumes you are already familiar with [TanStack Query](https://tanstack.com/query/latest). If you need a refresher, review the official TanStack Query documentation before continuing.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/tanstack-query@beta
```

```sh [yarn]
yarn add @orpc/tanstack-query@beta
```

```sh [pnpm]
pnpm add @orpc/tanstack-query@beta
```

```sh [bun]
bun add @orpc/tanstack-query@beta
```

```sh [deno]
deno add npm:@orpc/tanstack-query@beta
```

:::

## Setup

Before you begin, set up either a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { client } from './shared/planet'
// ---cut---
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

const orpc = createTanstackQueryUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//

//

//

//

//

//
```

::: details Avoiding Query and Mutation Key Conflicts?

To avoid key conflicts when creating multiple sets of utils, pass a unique `prefix`. It becomes the first element of every query/mutation key, so keys from different utils never overlap.

```ts
const userORPC = createTanstackQueryUtils(userClient, {
  prefix: 'user'
})

const postORPC = createTanstackQueryUtils(postClient, {
  prefix: 'post'
})
```

:::

## Query Options

Use `.queryOptions` to build query options. It works with `useQuery`, `useSuspenseQuery`, and `prefetchQuery`, and any other API that accepts query options.

```ts
const query = useQuery(orpc.planet.find.queryOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))
```

## Streamed Query Options

Use `.streamedOptions` to build streamed query options for an [AsyncIteratorObject](/docs/async-iterator-object). The resulting data is an array of events, and each new event is appended as it arrives.

It works with `useQuery`, `useSuspenseQuery`, and `prefetchQuery`, and any other API that accepts query options.

```ts
const query = useQuery(orpc.streamed.streamedOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  queryFnOptions: { // Configure streamed query behavior
    refetchMode: 'reset',
    maxChunks: 3,
  },
  retry: true, // Infinite retry for more reliable streaming
  // additional options...
}))
```

::: info
`refetchMode` determines how data is handled when the query is fetched again:

- `'reset'` _(default)_: Clears existing data and returns the query to a pending state.
- `'append'`: Adds new streamed chunks to the existing data.
- `'replace'`: Buffers streamed data and replaces the cache after the stream completes.

:::

## Live Query Options

Use `.liveOptions` to build live query options for an [AsyncIteratorObject](/docs/async-iterator-object). The data always reflects the latest event, replacing the previous value whenever a new one arrives.

It works with `useQuery`, `useSuspenseQuery`, and `prefetchQuery`, and any other API that accepts query options.

```ts
const query = useQuery(orpc.live.liveOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  retry: true, // Infinite retry for more reliable streaming
  // additional options...
}))
```

## Infinite Query Options

Use `.infiniteOptions` to build infinite query options. It works with `useInfiniteQuery`, `useSuspenseInfiniteQuery`, and `prefetchInfiniteQuery`, and any other API that accepts infinite query options.

::: info
The `input` option must be a function that receives the page parameter and returns the query input. Define the `pageParam` type explicitly if it can be `null` or `undefined`.
:::

```ts
const query = useInfiniteQuery(orpc.planet.list.infiniteOptions({
  input: (pageParam: number | undefined) => ({ limit: 10, offset: pageParam }),
  context: { cache: true }, // Provide client context if needed
  initialPageParam: undefined,
  getNextPageParam: lastPage => lastPage.nextPageParam,
  // additional options...
}))
```

## Mutation Options

Use `.mutationOptions` to build mutation options. It works with `useMutation` and any other API that accepts mutation options.

```ts
const mutation = useMutation(orpc.planet.create.mutationOptions({
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))

mutation.mutate({ name: 'Earth' })
```

## Query and Mutation Keys

oRPC provides helper methods for generating query and mutation keys:

- `.key`: Generates a **partial-match** key for actions such as invalidating queries or checking mutation status.
- `.queryKey`: Generates a **full-match** key for [Query Options](#query-options).
- `.streamedKey`: Generates a **full-match** key for [Streamed Query Options](#streamed-query-options).
- `.liveKey`: Generates a **full-match** key for [Live Query Options](#live-query-options).
- `.infiniteKey`: Generates a **full-match** key for [Infinite Query Options](#infinite-query-options).
- `.mutationKey`: Generates a **full-match** key for [Mutation Options](#mutation-options).

```ts
const queryClient = useQueryClient()

// Invalidate all planet queries
queryClient.invalidateQueries({
  queryKey: orpc.planet.key(),
})

// Invalidate only regular (non-infinite) planet queries
queryClient.invalidateQueries({
  queryKey: orpc.planet.key({ type: 'query' })
})

// Invalidate the planet find query with id 123
queryClient.invalidateQueries({
  queryKey: orpc.planet.find.key({ input: { id: 123 } })
})

// Walk back the key path with `back` — this equals orpc.planet.key()
queryClient.invalidateQueries({
  queryKey: orpc.planet.find.key({ back: 1 })
})

// Update the planet find query with id 123
queryClient.setQueryData(orpc.planet.find.queryKey({ input: { id: 123 } }), (old) => {
  return { ...old, id: 123, name: 'Earth' }
})
```

## Calling Clients

The `.call` method provides direct access to the underlying procedure client when needed.

```ts
const planet = await orpc.planet.find.call({ id: 123 })
```

## Reactive Options

In reactive libraries like Vue or Solid, TanStack Query supports passing computed values as options. The exact API varies by framework, so refer to the TanStack Query documentation for [Vue](https://tanstack.com/query/latest/docs/framework/vue/reactivity) or [Solid](https://tanstack.com/query/latest/docs/framework/solid/reference/useQuery#reactive-options).

::: code-group

```ts [Options as Function]
const query = useQuery(
  () => orpc.planet.find.queryOptions({
    input: { id: id() },
  })
)
```

```ts [Computed Options]
const query = useQuery(computed(
  () => orpc.planet.find.queryOptions({
    input: { id: id.value },
  })
))
```

:::

## Default Options

Use `scoped` to configure default options for scoped query and mutation utilities. Each value can be either a partial options object, which is spread-merged with lower priority than per-call options, or a function that receives the per-call options and returns the merged result.

```ts
const orpc = createTanstackQueryUtils(client, {
  scoped: {
    planet: {
      find: {
        queryKey: options => ({
          // Override the auto-generated query key for .queryKey and .queryOptions
          queryKey: options.queryKey ?? ['planet', 'find', options.input]
        }),
        queryOptions: {
          staleTime: 60 * 1000, // 1 minute
          retry: 3,
        },
      },
      list: {
        infiniteOptions: options => ({
          ...options,
          staleTime: 30 * 1000, // override takes priority
        }),
      },
      create: {
        mutationOptions: {
          onSuccess: (output, input, _, ctx) => {
            ctx.client.invalidateQueries({ queryKey: orpc.planet.key() })
          },
        },
      },
    },
  },
})

// These calls automatically use the default options
const query = useQuery(orpc.planet.find.queryOptions({ input: { id: 123 } }))
const mutation = useMutation(orpc.planet.create.mutationOptions())

// User-provided options take precedence
const customQuery = useQuery(orpc.planet.find.queryOptions({
  input: { id: 123 },
  staleTime: 0, // overrides the default staleTime
}))
```

::: info
When you configure `queryKey`, it also affects `.queryOptions` because it is used internally to generate query keys. The same applies to live, streamed, infinite, and mutation options when you configure their keys.
:::

## Interceptors

Interceptors let you wrap `queryFn` and `mutationFn` calls. Unlike [default options](#default-options), which can be overridden by per-call options, interceptors always run for every query and mutation.

```ts
import { isInferableError, safe } from '@orpc/client'

const orpc = createTanstackQueryUtils(client, {
  queryInterceptors: [],
  liveInterceptors: [],
  streamedInterceptors: [],
  infiniteInterceptors: [],
  mutationInterceptors: [
    async ({ context, path, next }) => {
      const [error, data] = await safe(next())

      if (error) {
        if (isInferableError(error)) {
          // handle typesafe errors
        }

        throw error
      }

      return data
    }
  ],
  scoped: {
    planet: {
      create: {
        mutationInterceptors: [
          async ({ next, fnContext }) => {
            const result = await next()
            fnContext.client.invalidateQueries({ queryKey: orpc.planet.key() })
            return result
          },
        ],
      },
    },
  },
})
```

::: info
You can use [`safe` and `isInferableError`](/docs/client/error-handling#using-safe-and-isinferableerror) together for typesafe error handling in interceptors.
:::

## Plugins

Plugins package reusable defaults and interceptors for queries and mutations.

```ts
const orpc = createTanstackQueryUtils(client, {
  plugins: []
})
```

### Contract Options Plugin

Use `tanstackQuery` to define base options and interceptors directly on a [procedure contract](/docs/contract/procedure), then pass the contract to `ContractOptionsUtilsPlugin` to apply them automatically. Meta options act as the base layer: [default options](#default-options) and [interceptors](#interceptors) defined on the utils merge on top of them.

```ts
import { ContractOptionsUtilsPlugin, tanstackQuery } from '@orpc/tanstack-query'

export const contract = {
  planet: {
    find: oc
      .input(z.object({ id: z.number() }))
      .meta(tanstackQuery({
        queryOptions: {
          staleTime: 60 * 1000,
        },
        queryInterceptors: [
          async ({ input, next }) => {
            // input, output, and errors are typed based on the contract
            return await next()
          },
        ],
      })),
  },
}

const orpc = createTanstackQueryUtils(client, {
  plugins: [new ContractOptionsUtilsPlugin(contract)],
})
```

::: warning
Types inferred from the contract are for reference only. The actual types depend on the client the utils are created from. For example, a `JsonifiedClient` created from [OpenAPI Link](/docs/openapi/link#typesafe-clients) returns jsonified outputs that may not match the contract schemas.
:::

::: details Accessing router utils inside interceptors?
Contract interceptors cannot import your router utils directly, but you can pass them through mutation meta. [Register a global meta type](https://tanstack.com/query/latest/docs/framework/react/typescript#registering-global-meta) that carries the utils, then read it from `fnContext.meta` to invalidate queries, apply optimistic updates, and more.

```ts
import type { RouterContractClient } from '@orpc/contract'
import type { RouterUtils } from '@orpc/tanstack-query'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      utils?: RouterUtils<RouterContractClient<typeof contract>>
    }
  }
}

export const contract = {
  planet: {
    find: oc.input(z.object({ id: z.number() })),
    update: oc
      .input(z.object({ id: z.number(), name: z.string() }))
      .meta(tanstackQuery({
        mutationInterceptors: [
          async ({ next, fnContext }) => {
            const output = await next()

            // invalidate planet queries after a successful update
            if (fnContext.meta?.utils) {
              await fnContext.client.invalidateQueries({
                queryKey: fnContext.meta.utils.planet.key(),
              })
            }

            return output
          },
        ],
      })),
  },
}

const mutation = useMutation(orpc.planet.update.mutationOptions({
  meta: { utils: orpc },
}))
```

:::

## Client Context

::: warning
oRPC excludes [client context](/docs/client/client-side#client-context) from query keys. Override the query key manually when you need to prevent unintended query deduplication.

```ts
const query = useQuery(orpc.planet.find.queryOptions({
  context: { cache: true },
  // manually include context in the query key
  queryKey: [['planet', 'find'], { context: { cache: true } }],
  // additional options...
}))
```

:::

When a client is invoked through the TanStack Query integration, an **operation context** is automatically added to the [client context](/docs/client/client-side#client-context). You can use this context to configure request behavior, such as selecting the HTTP method for [RPC Link](/docs/rpc/link#request-method).

```ts twoslash
import { RPCLink } from '@orpc/client/fetch'
// ---cut---
import {
  TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL,
  TanstackQueryOperationContext,
} from '@orpc/tanstack-query'

interface ClientContext extends TanstackQueryOperationContext {
}

const GET_OPERATION_TYPE = new Set(['query', 'streamed', 'live', 'infinite'])

const link = new RPCLink<ClientContext>({
  method: ({ context }) => {
    const operationType = context[TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]?.type

    if (operationType && GET_OPERATION_TYPE.has(operationType)) {
      return 'GET'
    }

    return 'POST'
  },
})
```

## Typesafe Error Handling

Use the built-in `isInferableError` helper to handle [typesafe errors](/docs/error-handling#typesafe-errors) in queries and mutations.

```ts
import { isInferableError } from '@orpc/client'

const mutation = useMutation(orpc.planet.create.mutationOptions({
  onError: (error) => {
    if (isInferableError(error)) {
      // Handle typesafe errors here
    }
  }
}))

mutation.mutate({ name: 'Earth' })

if (mutation.error && isInferableError(mutation.error)) {
  // Handle the typesafe errors here
}
```

## `skipToken` for Disabling Queries

The [skipToken symbol](https://tanstack.com/query/latest/docs/framework/react/guides/disabling-queries#typesafe-disabling-of-queries-using-skiptoken) provides a typesafe alternative to setting `enabled: false` when you want to disable a query by omitting its `input`.

```ts
const query = useQuery(
  orpc.planet.list.queryOptions({
    input: search ? { search } : skipToken, // [!code highlight]
  })
)

const query = useInfiniteQuery(
  orpc.planet.list.infiniteOptions({
    input: search // [!code highlight]
      ? (offset: number | undefined) => ({ limit: 10, offset, search }) // [!code highlight]
      : skipToken, // [!code highlight]
    initialPageParam: undefined,
    getNextPageParam: lastPage => lastPage.nextPageParam,
  })
)
```

## Custom Serializers

If needed, you can extend the default TanStack Query serializer to support additional types supported by oRPC. Learn more about [RPC Serializers](/docs/rpc/serializer) and [TanStack Query Server Rendering & Hydration](https://tanstack.com/query/latest/docs/framework/react/guides/ssr).

```ts
import { RPCSerializer } from '@orpc/client'

const serializer = new RPCSerializer({
  handlers: {
    // put custom serializers here
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn(queryKey) {
        const serialized = serializer.serialize(queryKey, { useFormDataForBlobFields: false })
        return JSON.stringify(serialized)
      },
      staleTime: 60 * 1000, // > 0 to prevent immediate refetching on mount
    },
    dehydrate: {
      serializeData(data) {
        return serializer.serialize(data, { useFormDataForBlobFields: false })
      }
    },
    hydrate: {
      deserializeData(data) {
        return serializer.deserialize(data)
      }
    },
  }
})
```
