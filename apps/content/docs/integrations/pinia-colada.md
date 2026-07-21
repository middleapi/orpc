# Pinia Colada Integration

[Pinia Colada](https://pinia-colada.esm.dev/) integration provides utilities for using oRPC clients with Pinia Colada. It includes helper methods for building query and mutation options, as well as query and mutation keys.

::: warning
This guide assumes you are already familiar with [Pinia Colada](https://pinia-colada.esm.dev/). If you need a refresher, review the official Pinia Colada documentation before continuing.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/pinia-colada@beta
```

```sh [yarn]
yarn add @orpc/pinia-colada@beta
```

```sh [pnpm]
pnpm add @orpc/pinia-colada@beta
```

```sh [bun]
bun add @orpc/pinia-colada@beta
```

```sh [deno]
deno add npm:@orpc/pinia-colada@beta
```

:::

## Setup

Before you begin, set up either a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts
import { createPiniaColadaUtils } from '@orpc/pinia-colada'

const orpc = createPiniaColadaUtils(client)
```

::: details Avoiding Query and Mutation Key Conflicts?

To avoid key conflicts when creating multiple sets of utils, pass a unique `prefix`. It becomes the first element of every entry key, so entries from different utils never overlap.

```ts
const userORPC = createPiniaColadaUtils(userClient, {
  prefix: 'user'
})

const postORPC = createPiniaColadaUtils(postClient, {
  prefix: 'post'
})
```

:::

## Query Options Utility

Use `.queryOptions` to build query options. It works with `useQuery` and any other API that accepts query options.

```ts
const query = useQuery(orpc.planet.find.queryOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))
```

::: info
Options accept plain values only. For reactive inputs, pass a callback to `useQuery` as described in [Reactive Options](#reactive-options).
:::

## Streamed Query Options Utility

Use `.streamedOptions` to build streamed query options for an [AsyncIteratorObject](/docs/async-iterator-object). The resulting data is an array of chunks, and each new chunk is appended as it arrives. It works with `useQuery` and any other API that accepts query options.

```ts
const query = useQuery(orpc.streamed.streamedOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  fnOptions: { // Configure streamed query behavior
    refetchMode: 'reset',
    maxChunks: 3,
  },
  // additional options...
}))
```

::: info
`refetchMode` determines how data is handled when the query is fetched again:

- `'reset'` _(default)_: Clears existing data and returns the query to a pending state.
- `'append'`: Adds new streamed chunks to the existing data.
- `'replace'`: Buffers streamed data and replaces the cache after the stream completes.

:::

## Live Query Options Utility

Use `.liveOptions` to build live query options for an [AsyncIteratorObject](/docs/async-iterator-object). The data always reflects the latest chunk, replacing the previous value whenever a new one arrives. It works with `useQuery` and any other API that accepts query options.

```ts
const query = useQuery(orpc.live.liveOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))
```

## Infinite Query Options Utility

Use `.infiniteOptions` to build infinite query options. It works with `useInfiniteQuery` and any other API that accepts infinite query options.

::: info
The `input` option must be a function that receives the page parameter and returns the query input. Define the `pageParam` type explicitly if it can be `null` or `undefined`.
:::

```ts
const query = useInfiniteQuery(() => orpc.planet.list.infiniteOptions({
  input: (offset: number) => ({ limit: 10, offset }),
  context: { cache: true }, // Provide client context if needed
  initialPageParam: 0,
  getNextPageParam: lastPage => lastPage.nextOffset,
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

## Query/Mutation Key

oRPC provides helper methods for generating query and mutation keys:

- `.key`: Generates a **partial-match** key for actions such as invalidating queries or checking mutation status.
- `.queryKey`: Generates a **full-match** key for [Query Options](#query-options-utility).
- `.streamedKey`: Generates a **full-match** key for [Streamed Query Options](#streamed-query-options-utility).
- `.liveKey`: Generates a **full-match** key for [Live Query Options](#live-query-options-utility).
- `.infiniteKey`: Generates a **full-match** key for [Infinite Query Options](#infinite-query-options-utility).
- `.mutationKey`: Generates a **full-match** key for [Mutation Options](#mutation-options).

```ts
const queryCache = useQueryCache()

// Invalidate all planet queries
queryCache.invalidateQueries({
  key: orpc.planet.key(),
})

// Invalidate only regular (non-infinite) planet queries
queryCache.invalidateQueries({
  key: orpc.planet.key({ type: 'query' })
})

// Invalidate the planet find query with id 123
queryCache.invalidateQueries({
  key: orpc.planet.find.key({ input: { id: 123 } })
})

// Walk back the key path with `back` — this equals orpc.planet.key()
queryCache.invalidateQueries({
  key: orpc.planet.find.key({ back: 1 })
})

// Update the planet find query with id 123
queryCache.setQueryData(orpc.planet.find.queryKey({ input: { id: 123 } }), (old) => {
  return { ...old, id: 123, name: 'Earth' }
})
```

::: info
Because Pinia Colada requires entry keys to be serializable, oRPC serializes inputs into JSON-compatible values (including native types like `Date`, `URL`, `BigInt`, etc.) when building keys.
:::

## Calling Procedure Clients

The `.call` method provides direct access to the underlying procedure client when needed.

```ts
const planet = await orpc.planet.find.call({ id: 123 })
```

## Reactive Options

Option utilities accept plain values only. For reactive inputs, pass a callback to `useQuery` instead — it re-evaluates whenever its dependencies change.

```ts
const id = ref(123)

const query = useQuery(() => orpc.planet.find.queryOptions({
  input: { id: id.value },
}))
```

## Default Options

Use `scoped` to configure default options for scoped query and mutation utilities. Each value can be either a partial options object, which is spread-merged with lower priority than per-call options, or a function that receives the per-call options and returns the merged result.

```ts
const orpc = createPiniaColadaUtils(client, {
  scoped: {
    planet: {
      find: {
        queryKey: options => ({
          // Override the auto-generated key for .queryKey and .queryOptions
          key: options.key ?? ['planet', 'find', options.input]
        }),
        queryOptions: {
          staleTime: 60 * 1000, // 1 minute
        },
      },
      create: {
        mutationOptions: {
          onSuccess: () => {
            // runs for every planet.create mutation
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
When you configure `queryKey`, it also affects `.queryOptions` because it is used internally to generate keys. The same applies to infinite and mutation options when you configure their keys.
:::

## Interceptors

Interceptors let you wrap `query` and `mutation` calls. Unlike [default options](#default-options), which can be overridden by per-call options, interceptors always run for every query and mutation. Each interceptor receives the corresponding procedure utils through the `utils` option, so you can build keys like `utils.key({ back: 1 })` to target a parent scope.

```ts
import { isInferableError, safe } from '@orpc/client'

const orpc = createPiniaColadaUtils(client, {
  queryInterceptors: [],
  streamedInterceptors: [],
  liveInterceptors: [],
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
})
```

::: info
You can use [`safe` and `isInferableError`](/docs/client/error-handling#using-safe-and-isinferableerror) together for typesafe error handling in interceptors.
:::

## Plugins

Plugins package reusable defaults and interceptors for queries and mutations.

```ts
const orpc = createPiniaColadaUtils(client, {
  plugins: []
})
```

## Client Context

When a client is invoked through the Pinia Colada integration, an **operation context** is automatically added to the [client context](/docs/client/client-side#client-context). You can use this context to configure request behavior, such as selecting the HTTP method for [RPC Link](/docs/rpc/link#request-method).

```ts
import {
  PINIA_COLADA_OPERATION_CONTEXT_SYMBOL,
  PiniaColadaOperationContext,
} from '@orpc/pinia-colada'
import { RPCLink } from '@orpc/client/fetch'

interface ClientContext extends PiniaColadaOperationContext {
}

const GET_OPERATION_TYPE = new Set(['query', 'streamed', 'live', 'infinite'])

const link = new RPCLink<ClientContext>({
  method: ({ context }) => {
    const operationType = context[PINIA_COLADA_OPERATION_CONTEXT_SYMBOL]?.type

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

if (mutation.error.value && isInferableError(mutation.error.value)) {
  // Handle the typesafe errors here
}
```
