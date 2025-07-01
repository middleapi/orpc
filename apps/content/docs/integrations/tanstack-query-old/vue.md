---
title: Tanstack Query Integration For Vue
description: Seamlessly integrate oRPC with Tanstack Query for Vue
---

# Tanstack Query Integration For Vue

This guide shows how to integrate oRPC with Tanstack Query for Vue. For an introduction, please review the [Basic Guide](/docs/integrations/tanstack-query-old/basic) first.

## Installation

::: code-group

```sh [npm]
npm install @orpc/vue-query@latest @tanstack/vue-query@latest
```

```sh [yarn]
yarn add @orpc/vue-query@latest @tanstack/vue-query@latest
```

```sh [pnpm]
pnpm add @orpc/vue-query@latest @tanstack/vue-query@latest
```

```sh [bun]
bun add @orpc/vue-query@latest @tanstack/vue-query@latest
```

```sh [deno]
deno install npm:@orpc/vue-query@latest npm:@tanstack/vue-query@latest
```

:::

## Setup

Before you begin, ensure you have already configured a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router>
// ---cut---
import { createORPCVueQueryUtils } from '@orpc/vue-query'

export const orpc = createORPCVueQueryUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//
```

## Avoiding Query/Mutation Key Conflicts

Prevent key conflicts by passing a unique base key when creating your utils:

```ts
const userORPC = createORPCVueQueryUtils(userClient, {
  path: ['user']
})
const postORPC = createORPCVueQueryUtils(postClient, {
  path: ['post']
})
```
