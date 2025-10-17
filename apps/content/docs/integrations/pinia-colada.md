---
title: Pinia Colada Integration
description: Seamlessly integrate oRPC with Pinia Colada
---

# Pinia Colada Integration

[Pinia Colada](https://pinia-colada.esm.dev/) is the data fetching layer for Pinia and Vue. oRPC's integration with Pinia Colada is lightweight and straightforward - there's no extra overhead.

::: warning
This documentation assumes you are already familiar with [Pinia Colada](https://pinia-colada.esm.dev/). If you need a refresher, please review the official Pinia Colada documentation before proceeding.
:::

::: warning
[Pinia Colada](https://pinia-colada.esm.dev/) is still in an unstable stage. As a result, this integration may introduce breaking changes in the future to keep up with its ongoing development.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/vue-colada@latest @pinia/colada@latest
```

```sh [yarn]
yarn add @orpc/vue-colada@latest @pinia/colada@latest
```

```sh [pnpm]
pnpm add @orpc/vue-colada@latest @pinia/colada@latest
```

```sh [bun]
bun add @orpc/vue-colada@latest @pinia/colada@latest
```

```sh [deno]
deno add npm:@orpc/vue-colada@latest npm:@pinia/colada@latest
```

:::

## Setup

Before you begin, ensure you have already configured a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router>
// ---cut---
import { createORPCVueColadaUtils } from '@orpc/vue-colada'

export const orpc = createORPCVueColadaUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//
```

## Avoiding Query/Mutation Key Conflicts

Prevent key conflicts by passing a unique base key when creating your utils:

```ts
const userORPC = createORPCVueColadaUtils(userClient, {
  path: ['user']
})
const postORPC = createORPCVueColadaUtils(postClient, {
  path: ['post']
})
```

## Query Options Utility

Use `.queryOptions` to configure queries. Use it with hooks like `useQuery`, `useSuspenseQuery`, or `prefetchQuery`.

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'
import { RouterUtils } from '@orpc/vue-colada'
import { useQuery } from '@pinia/colada'

declare const orpc: RouterUtils<RouterClient<typeof router>>
// ---cut---
const query = useQuery(orpc.planet.find.queryOptions({
  input: { id: 123 }, // Specify input if needed
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))
```

## Mutation Options

Use `.mutationOptions` to create options for mutations. Use it with hooks like `useMutation`.

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'
import { RouterUtils } from '@orpc/vue-colada'
import { useMutation } from '@pinia/colada'

declare const orpc: RouterUtils<RouterClient<typeof router>>
// ---cut---
const mutation = useMutation(orpc.planet.create.mutationOptions({
  context: { cache: true }, // Provide client context if needed
  // additional options...
}))

mutation.mutate({ name: 'Earth' })
```

## Query/Mutation Key

Use `.key` to generate a `QueryKey` or `MutationKey`. This is useful for tasks such as revalidating queries, checking mutation status, etc.

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'
import { RouterUtils } from '@orpc/vue-colada'
import { useQueryCache } from '@pinia/colada'

declare const orpc: RouterUtils<RouterClient<typeof router>>
// ---cut---
const queryCache = useQueryCache()

// Invalidate all planet queries
queryCache.invalidateQueries({
  key: orpc.planet.key(),
})

// Invalidate the planet find query with id 123
queryCache.invalidateQueries({
  key: orpc.planet.find.key({ input: { id: 123 } })
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
  },
}))

mutation.mutate({ name: 'Earth' })

if (mutation.error.value && isDefinedError(mutation.error.value)) {
  // Handle the error here
}
```

For more details, see our [type-safe error handling guide](/docs/error-handling#type‐safe-error-handling).
