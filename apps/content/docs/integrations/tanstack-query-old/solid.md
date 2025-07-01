---
title: Tanstack Query Integration For Solid
description: Seamlessly integrate oRPC with Tanstack Query for Solid
---

# Tanstack Query Integration For Solid

This guide shows how to integrate oRPC with Tanstack Query for Solid. For an introduction, please review the [Basic Guide](/docs/integrations/tanstack-query-old/basic) first.

## Installation

::: code-group

```sh [npm]
npm install @orpc/solid-query@latest @tanstack/solid-query@latest
```

```sh [yarn]
yarn add @orpc/solid-query@latest @tanstack/solid-query@latest
```

```sh [pnpm]
pnpm add @orpc/solid-query@latest @tanstack/solid-query@latest
```

```sh [bun]
bun add @orpc/solid-query@latest @tanstack/solid-query@latest
```

```sh [deno]
deno install npm:@orpc/solid-query@latest npm:@tanstack/solid-query@latest
```

:::

## Setup

Before you begin, ensure you have already configured a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router>
// ---cut---
import { createORPCSolidQueryUtils } from '@orpc/solid-query'

export const orpc = createORPCSolidQueryUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//
```

## Avoiding Query/Mutation Key Conflicts

Prevent key conflicts by passing a unique base key when creating your utils:

```ts
const userORPC = createORPCSolidQueryUtils(userClient, {
  path: ['user']
})
const postORPC = createORPCSolidQueryUtils(postClient, {
  path: ['post']
})
```

## Usage

:::warning
Unlike the React version, when creating a Solid Query Signal, the first argument must be a callback.
:::

```ts twoslash
import type { router } from './shared/planet'
import type { RouterClient } from '@orpc/server'
import type { RouterUtils } from '@orpc/solid-query'

declare const orpc: RouterUtils<RouterClient<typeof router>>
declare const condition: boolean
// ---cut---
import { createQuery } from '@tanstack/solid-query'

const query = createQuery(
  () => orpc.planet.find.queryOptions({ input: { id: 123 } })
)
```
