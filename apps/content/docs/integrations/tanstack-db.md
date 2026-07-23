# TanStack DB Integration

[TanStack DB](https://tanstack.com/db/latest) integration provides utilities for wiring typed oRPC procedures into TanStack DB collections. It includes helpers for building collection options and persistence handlers.

::: warning
This guide assumes you are already familiar with [TanStack DB](https://tanstack.com/db/latest). If you need a refresher, review the official TanStack DB documentation before continuing.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-tanstack-db@beta @tanstack/db @tanstack/query-db-collection
```

```sh [yarn]
yarn add @orpc/experimental-tanstack-db@beta @tanstack/db @tanstack/query-db-collection
```

```sh [pnpm]
pnpm add @orpc/experimental-tanstack-db@beta @tanstack/db @tanstack/query-db-collection
```

```sh [bun]
bun add @orpc/experimental-tanstack-db@beta @tanstack/db @tanstack/query-db-collection
```

```sh [deno]
deno add npm:@orpc/experimental-tanstack-db@beta npm:@tanstack/db npm:@tanstack/query-db-collection
```

:::

## Setup

Before you begin, set up either a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts
import { createTanstackDBUtils } from '@orpc/experimental-tanstack-db'

const orpc = createTanstackDBUtils(client)
```

::: details Avoiding Key Conflicts?

To avoid key conflicts when creating multiple sets of utils, pass a unique `prefix`. It becomes the first element of every key, so keys from different utils never overlap.

```ts
const userORPC = createTanstackDBUtils(userClient, {
  prefix: 'user'
})

const postORPC = createTanstackDBUtils(postClient, {
  prefix: 'post'
})
```

:::

## Collection Options Utility

Use `.collectionOptions` to build [Query Collection](https://tanstack.com/db/latest/docs/collections/query-collection) options for `createCollection`. It is built on top of `queryCollectionOptions` from `@tanstack/query-db-collection` and accepts the same options, except `queryKey` and `queryFn` are wired to the procedure for you.

```ts
import { createCollection } from '@tanstack/db'

const todosCollection = createCollection(orpc.todo.list.collectionOptions({
  input: () => ({ search: 'orpc' }), // Resolve procedure input for each subset
  context: () => ({ cache: true }), // Provide client context if needed
  queryClient,
  getKey: todo => todo.id,
  onInsert: orpc.todo.create.mutationHandler({
    input: mutation => mutation.modified,
  }),
  onUpdate: orpc.todo.update.mutationHandler({
    input: mutation => ({ id: mutation.key, data: mutation.changes }),
  }),
  onDelete: orpc.todo.delete.mutationHandler({
    input: mutation => ({ id: mutation.key }),
  }),
  // additional options...
}))
```

Everything else stays fully native to TanStack DB, such as [live queries](https://tanstack.com/db/latest/docs/guides/live-queries) and [optimistic mutations](https://tanstack.com/db/latest/docs/guides/mutations):

```ts
const { data: todos } = useLiveQuery(q =>
  q.from({ todo: todosCollection })
    .where(({ todo }) => eq(todo.completed, false))
)
```

::: info
The query key is generated the same way as in the [Tanstack Query Integration](/docs/integrations/tanstack-query), so both integrations can share a `queryClient` and actions like invalidation work across them.
:::

The `input` option resolves the procedure input from [load subset options](https://tanstack.com/db/latest/docs/collections/query-collection#queryfn-and-predicate-push-down), and the resolved input becomes part of the generated query key. With [on-demand sync mode](https://tanstack.com/db/latest/docs/collections/query-collection#queryfn-and-predicate-push-down), each subset is fetched and cached with its own input:

```ts
const todosCollection = createCollection(orpc.todo.list.collectionOptions({
  syncMode: 'on-demand',
  input: options => ({ limit: options.limit }),
  queryClient,
  getKey: todo => todo.id,
}))
```

## Mutation Handler Utility

Use `.mutationHandler` to build a [persistence handler](https://tanstack.com/db/latest/docs/guides/mutations) for collection options like `onInsert`, `onUpdate`, and `onDelete`. The procedure is called once per mutation in the transaction, with the `input` and `context` options resolved for each mutation.

```ts
const onUpdate = orpc.todo.update.mutationHandler({
  input: mutation => ({ id: mutation.key, data: mutation.changes }),
  context: mutation => ({ cache: true }), // Provide client context if needed
})
```

By default, [Query Collection](https://tanstack.com/db/latest/docs/collections/query-collection) refetches after a handler completes. Use the `refetch` option to control this behavior, either statically or based on the procedure outputs:

```ts
const onUpdate = orpc.todo.update.mutationHandler({
  input: mutation => ({ id: mutation.key, data: mutation.changes }),
  refetch: false, // or (outputs, params) => boolean
})
```

## Operation Key Utility

Use `.key` to generate a **partial matching** key for actions like invalidating queries synced by collections:

```ts
queryClient.invalidateQueries({
  queryKey: orpc.todo.key()
})
```

## Calling Procedure Clients

Use `.call` to call a procedure client directly. It's an alias for corresponding procedure client.

```ts
const todos = await orpc.todo.list.call({ search: 'orpc' })
```
