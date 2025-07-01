---
title: Tanstack Query Integration For Svelte
description: Seamlessly integrate oRPC with Tanstack Query for Svelte
---

# Tanstack Query Integration For Svelte

This guide shows how to integrate oRPC with Tanstack Query for Svelte. For an introduction, please review the [Basic Guide](/docs/integrations/tanstack-query-old/basic) first.

## Installation

::: code-group

```sh [npm]
npm install @orpc/svelte-query@latest @tanstack/svelte-query@latest
```

```sh [yarn]
yarn add @orpc/svelte-query@latest @tanstack/svelte-query@latest
```

```sh [pnpm]
pnpm add @orpc/svelte-query@latest @tanstack/svelte-query@latest
```

```sh [bun]
bun add @orpc/svelte-query@latest @tanstack/svelte-query@latest
```

```sh [deno]
deno install npm:@orpc/svelte-query@latest npm:@tanstack/svelte-query@latest
```

:::

## Setup

Before you begin, ensure you have already configured a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router>
// ---cut---
import { createORPCSvelteQueryUtils } from '@orpc/svelte-query'

export const orpc = createORPCSvelteQueryUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//
```

## Avoiding Query/Mutation Key Conflicts

Prevent key conflicts by passing a unique base key when creating your utils:

```ts
const userORPC = createORPCSvelteQueryUtils(userClient, {
  path: ['user']
})
const postORPC = createORPCSvelteQueryUtils(postClient, {
  path: ['post']
})
```

## Reactivity

To create reactive queries, use Svelte's legacy `derived` API from `svelte/store`. With the [Tanstack Svelte v5 branch](https://github.com/TanStack/query/discussions/7413), oRPC should work out of the box.

```ts twoslash
import type { router } from './shared/planet'
import type { RouterClient } from '@orpc/server'
import type { RouterUtils } from '@orpc/svelte-query'

declare const orpc: RouterUtils<RouterClient<typeof router>>
declare const condition: boolean
// ---cut---
import { createQuery } from '@tanstack/svelte-query'
import { derived, writable } from 'svelte/store'

const id = writable(123)

const query = createQuery(
  derived(id, $id => orpc.planet.find.queryOptions({ input: { id: $id } })),
)
```
