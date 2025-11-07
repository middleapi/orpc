---
title: Tanstack Query Integration
description: Seamlessly integrate oRPC with Tanstack Query
---

# Tanstack Query Integration

[Tanstack Query](https://tanstack.com/query/latest) is a robust solution for asynchronous state management. oRPC Tanstack Query integration is very lightweight and straightforward - supporting all libraries that Tanstack Query supports (React, Vue, Angular, Solid, Svelte, etc.).

::: warning
This documentation assumes you are already familiar with [Tanstack Query](https://tanstack.com/query/latest). If you need a refresher, please review the official Tanstack Query documentation before proceeding.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/tanstack-query@latest
```

```sh [yarn]
yarn add @orpc/tanstack-query@latest
```

```sh [pnpm]
pnpm add @orpc/tanstack-query@latest
```

```sh [bun]
bun add @orpc/tanstack-query@latest
```

```sh [deno]
deno add npm:@orpc/tanstack-query@latest
```

:::

## Setup

Before you begin, ensure you have already configured a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router>
// ---cut---
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

export const orpc = createTanstackQueryUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//

//

//

//

//

//
```

::: details Avoiding Query/Mutation Key Conflicts?

You can easily avoid key conflicts by passing a unique base key when creating your utils:

```ts
const userORPC = createTanstackQueryUtils(userClient, {
  path: ['user']
})

const postORPC = createTanstackQueryUtils(postClient, {
  path: ['post']
})
```

:::

## Query Options

Use `.queryOptions` to configure queries. Use it with hooks like `useQuery`, `useSuspenseQuery`, or `prefetchQuery`.

```ts
const query = useQuery(orpc.planet.find.queryOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))
```

## Streamed Query Options

Use `.streamedOptions` to configure queries for [Event Iterator](/docs/event-iterator). Data is an array of events, and each new event is appended to the end of the array as it arrives.

Works with hooks like `useQuery`, `useSuspenseQuery`, or `prefetchQuery`.

```ts
const query = useQuery(orpc.streamed.experimental_streamedOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  queryFnOptions: { // Configure streamedQuery behavior
    refetchMode: 'reset',
    maxChunks: 3,
  },
  retry: true, // Infinite retry for more reliable streaming
  // additional options...
}))
```

## Live Query Options

Use `.liveOptions` to configure live queries for [Event Iterator](/docs/event-iterator). Data is always the latest event, replacing the previous value whenever a new one arrives.

Works with hooks like `useQuery`, `useSuspenseQuery`, or `prefetchQuery`.

```ts
const query = useQuery(orpc.live.experimental_liveOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  retry: true, // Infinite retry for more reliable streaming
  // additional options...
}))
```

## Infinite Query Options

Use `.infiniteOptions` to configure infinite queries. Use it with hooks like `useInfiniteQuery`, `useSuspenseInfiniteQuery`, or `prefetchInfiniteQuery`.

::: info
The `input` parameter must be a function that accepts the page parameter and returns the query input. Be sure to define the type for `pageParam` if it can be `null` or `undefined`.
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

Use `.mutationOptions` to create options for mutations. Use it with hooks like `useMutation`.

```ts
const mutation = useMutation(orpc.planet.create.mutationOptions({
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))

mutation.mutate({ name: 'Earth' })
```

## Query/Mutation Key

oRPC provides a set of helper methods to generate keys for queries and mutations:

- `.key`: Generate a **partial matching** key for actions like revalidating queries, checking mutation status, etc.
- `.queryKey`: Generate a **full matching** key for [Query Options](#query-options).
- `.streamedKey`: Generate a **full matching** key for [Streamed Query Options](#streamed-query-options).
- `.infiniteKey`: Generate a **full matching** key for [Infinite Query Options](#infinite-query-options).
- `.mutationKey`: Generate a **full matching** key for [Mutation Options](#mutation-options).

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

// Update the planet find query with id 123
queryClient.setQueryData(orpc.planet.find.queryKey({ input: { id: 123 } }), (old) => {
  return { ...old, id: 123, name: 'Earth' }
})
```

## Calling Clients

Use `.call` to call a procedure client directly. It's an alias for corresponding procedure client.

```ts
const planet = await orpc.planet.find.call({ id: 123 })
```

## Reactive Options

In reactive libraries like Vue or Solid, **TanStack Query** supports passing computed values as options. The exact usage varies by framework, so refer to the documentation for [Vue](https://tanstack.com/query/latest/docs/framework/vue/reactivity) or [Solid](https://tanstack.com/query/latest/docs/framework/solid/reference/useQuery#reactive-options) for details.

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

## Client Context

::: warning
oRPC excludes [client context](/docs/client/rpc-link#using-client-context) from query keys. Manually override query keys if needed to prevent unwanted query deduplication. Use built-in `retry` option instead of the [oRPC Client Retry Plugin](/docs/plugins/client-retry).

```ts
const query = useQuery(orpc.planet.find.queryOptions({
  context: { cache: true },
  queryKey: [['planet', 'find'], { context: { cache: true } }],
  retry: true, // Prefer using built-in retry option
  // additional options...
}))
```

:::

## Error Handling

Easily manage type-safe errors using our built-in `isDefinedError` helper.

```ts
import { isDefinedError } from '@orpc/client'

const mutation = useMutation(orpc.planet.create.mutationOptions({
  onError: (error) => {
    if (isDefinedError(error)) {
      // Handle type-safe error here
    }
  }
}))

mutation.mutate({ name: 'Earth' })

if (mutation.error && isDefinedError(mutation.error)) {
  // Handle the error here
}
```

::: info
For more details, see our [type-safe error handling guide](/docs/error-handling#type‐safe-error-handling).
:::

## `skipToken` for Disabling Queries

The `skipToken` symbol offers a type-safe alternative to the `disabled` option when you need to conditionally disable a query by omitting its `input`.

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

## Operation Context

When clients are invoked through the TanStack Query integration, an **operation context** is automatically added to the [client context](/docs/client/rpc-link#using-client-context). This context can be used to config the request behavior, like setting the HTTP method.

```ts
import {
  TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL,
  TanstackQueryOperationContext,
} from '@orpc/tanstack-query'

interface ClientContext extends TanstackQueryOperationContext {
}

const GET_OPERATION_TYPE = new Set(['query', 'streamed', 'live', 'infinite'])

const link = new RPCLink<ClientContext>({
  url: 'http://localhost:3000/rpc',
  method: ({ context }, path) => {
    const operationType = context[TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]?.type

    if (operationType && GET_OPERATION_TYPE.has(operationType)) {
      return 'GET'
    }

    return 'POST'
  },
})
```

## Hydration

To avoid issues like refetching on mount or waterfall issues, your app may need to use [TanStack Query Hydration](https://tanstack.com/query/latest/docs/framework/react/guides/ssr). For seamless integration with oRPC, extend the default serializer using the [RPC JSON Serializer](/docs/advanced/rpc-json-serializer) to support all oRPC types.

::: info
You can use any custom serializers, but if you're using oRPC, you should use its built-in serializers.
:::

```ts
import { StandardRPCJsonSerializer } from '@orpc/client/standard'

const serializer = new StandardRPCJsonSerializer({
  customJsonSerializers: [
    // put custom serializers here
  ]
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn(queryKey) {
        const [json, meta] = serializer.serialize(queryKey)
        return JSON.stringify({ json, meta })
      },
      staleTime: 60 * 1000, // > 0 to prevent immediate refetching on mount
    },
    dehydrate: {
      serializeData(data) {
        const [json, meta] = serializer.serialize(data)
        return { json, meta }
      }
    },
    hydrate: {
      deserializeData(data) {
        return serializer.deserialize(data.json, data.meta)
      }
    },
  }
})
```

::: details Next.js Example?

This feature is not limited to React or Next.js. You can use it with any library that supports TanStack Query hydration.

::: code-group

```ts [lib/serializer.ts]
import { StandardRPCJsonSerializer } from '@orpc/client/standard'

export const serializer = new StandardRPCJsonSerializer({
  customJsonSerializers: [
    // put custom serializers here
  ]
})
```

```ts [lib/query/client.ts]
import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query'
import { serializer } from '../serializer'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn(queryKey) {
          const [json, meta] = serializer.serialize(queryKey)
          return JSON.stringify({ json, meta })
        },
        staleTime: 60 * 1000, // > 0 to prevent immediate refetching on mount
      },
      dehydrate: {
        shouldDehydrateQuery: query => defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
        serializeData(data) {
          const [json, meta] = serializer.serialize(data)
          return { json, meta }
        },
      },
      hydrate: {
        deserializeData(data) {
          return serializer.deserialize(data.json, data.meta)
        }
      },
    }
  })
}
```

```tsx [lib/query/hydration.tsx]
import { createQueryClient } from './client'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { cache } from 'react'

export const getQueryClient = cache(createQueryClient)

export function HydrateClient(props: { children: React.ReactNode, client: QueryClient }) {
  return (
    <HydrationBoundary state={dehydrate(props.client)}>
      {props.children}
    </HydrationBoundary>
  )
}
```

```tsx [app/providers.tsx]
'use client'

import { useState } from 'react'
import { createQueryClient } from '../lib/query/client'
import { QueryClientProvider } from '@tanstack/react-query'

export function Providers(props: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}
```

```tsx [app/page.tsx]
import { getQueryClient, HydrateClient } from '../lib/query/hydration'
import { ListPlanets } from '../components/list-planets'

export default function Page() {
  const queryClient = getQueryClient()

  queryClient.prefetchQuery(
    orpc.planet.list.queryOptions(),
  )

  return (
    <HydrateClient client={queryClient}>
      <ListPlanets />
    </HydrateClient>
  )
}
```

```tsx [components/list-planets.tsx]
'use client'

import { useSuspenseQuery } from '@tanstack/react-query'

export function ListPlanets() {
  const { data, isError } = useSuspenseQuery(orpc.planet.list.queryOptions())

  if (isError) {
    return (
      <p>Something went wrong</p>
    )
  }

  return (
    <ul>
      {data.map(planet => (
        <li key={planet.id}>{planet.name}</li>
      ))}
    </ul>
  )
}
```

:::
