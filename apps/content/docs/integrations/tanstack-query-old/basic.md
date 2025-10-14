---
title: Tanstack Query Integration
description: Seamlessly integrate oRPC with Tanstack Query
---

# Tanstack Query Integration

[Tanstack Query](https://tanstack.com/query/latest) is a robust solution for asynchronous state management. oRPC's integration with Tanstack Query is lightweight and straightforward - there's no extra overhead.

| Library | Tanstack Query | oRPC Integration          |
| ------- | -------------- | ------------------------- |
| React   | ✅             | ✅                        |
| Vue     | ✅             | ✅                        |
| Angular | ✅             | ✅ (New Integration Only) |
| Solid   | ✅             | ✅                        |
| Svelte  | ✅             | ✅                        |

::: warning
This documentation assumes you are already familiar with [Tanstack Query](https://tanstack.com/query/latest). If you need a refresher, please review the official Tanstack Query documentation before proceeding.
:::

## Query Options Utility

Use `.queryOptions` to configure queries. Use it with hooks like `useQuery`, `useSuspenseQuery`, or `prefetchQuery`.

```ts
const query = useQuery(orpc.planet.find.queryOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))
```

## Infinite Query Options Utility

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

Use `.key` to generate a `QueryKey` or `MutationKey`. This is useful for tasks such as revalidating queries, checking mutation status, etc.

:::info
The `.key` accepts partial deep input, there's no need to supply full input.
:::

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
```

## Calling Procedure Clients

Use `.call` to call a procedure client directly. It's an alias for corresponding procedure client.

```ts
const result = orpc.planet.find.call({ id: 123 })
```

## Error Handling

Easily manage type-safe errors using our built-in `isDefinedError` helper.

```ts
import { isDefinedError } from '@orpc/client'

const mutation = useMutation(orpc.planet.create.mutationOptions({
  onError: (error) => {
    if (isDefinedError(error)) {
      // Handle the error here
    }
  }
}))

mutation.mutate({ name: 'Earth' })

if (mutation.error && isDefinedError(mutation.error)) {
  // Handle the error here
}
```

For more details, see our [type-safe error handling guide](/docs/error-handling#type‐safe-error-handling).

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
