---
title: Implement Contract
description: Learn how to implement a contract for contract-first development in oRPC
---

# Implement Contract

After defining your contract, the next step is to implement it in your server code. oRPC enforces your contract at runtime, ensuring that your API consistently adheres to its specifications.

## Installation

::: code-group

```sh [npm]
npm install @orpc/server@latest
```

```sh [yarn]
yarn add @orpc/server@latest
```

```sh [pnpm]
pnpm add @orpc/server@latest
```

```sh [bun]
bun add @orpc/server@latest
```

```sh [deno]
deno add npm:@orpc/server@latest
```

:::

## The Implementer

The `implement` function converts your contract into an implementer instance. This instance compatible with the original `os` from `@orpc/server` provides a type-safe interface to define your procedures and supports features like [Middleware](/docs/middleware) and [Context](/docs/context).

```ts twoslash
import { contract } from './shared/planet'
// ---cut---
import { implement } from '@orpc/server'

const os = implement(contract) // fully replaces the os from @orpc/server
```

## Implementing Procedures

Define a procedure by attaching a `.handler` to its corresponding contract, ensuring it adheres to the contract's specifications.

```ts twoslash
import { contract } from './shared/planet'
import { implement } from '@orpc/server'

const os = implement(contract)
// ---cut---
export const listPlanet = os.planet.list
  .handler(({ input }) => {
    // Your logic for listing planets
    return []
  })
```

## Building the Router

To assemble your API, create a router at the root level using `.router`. This ensures that the entire router is type-checked and enforces the contract at runtime.

```ts
const router = os.router({ // <-- Essential for full contract enforcement
  planet: {
    list: listPlanet,
    find: findPlanet,
    create: createPlanet,
  },
})
```

## Full Implementation Example

Below is a complete implementation of the contract defined in the [previous section](/docs/contract-first/define-contract).

```ts twoslash
import { contract } from './shared/planet'
import { implement } from '@orpc/server'
// ---cut---
const os = implement(contract)

export const listPlanet = os.planet.list
  .handler(({ input }) => {
    return []
  })

export const findPlanet = os.planet.find
  .handler(({ input }) => {
    return { id: 123, name: 'Planet X' }
  })

export const createPlanet = os.planet.create
  .handler(({ input }) => {
    return { id: 123, name: 'Planet X' }
  })

export const router = os.router({
  planet: {
    list: listPlanet,
    find: findPlanet,
    create: createPlanet,
  },
})
```
