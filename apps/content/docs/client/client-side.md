---
title: Client-Side Clients
description: Call your oRPC procedures remotely as if they were local functions.
---

# Client-Side Clients

Call your [procedures](/docs/procedure) remotely as if they were local functions.

## Installation

::: code-group

```sh [npm]
npm install @orpc/client@latest
```

```sh [yarn]
yarn add @orpc/client@latest
```

```sh [pnpm]
pnpm add @orpc/client@latest
```

```sh [bun]
bun add @orpc/client@latest
```

```sh [deno]
deno add npm:@orpc/client@latest
```

:::

## Creating a Client

This guide uses [RPCLink](/docs/client/rpc-link), so make sure your server is set up with [RPCHandler](/docs/rpc-handler) or any API that follows the [RPC Protocol](/docs/advanced/rpc-protocol).

```ts
import { createORPCClient, onError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RouterClient } from '@orpc/server'
import { ContractRouterClient } from '@orpc/contract'

const link = new RPCLink({
  url: 'http://localhost:3000/rpc',
  headers: () => ({
    authorization: 'Bearer token',
  }),
  // fetch: <-- provide fetch polyfill fetch if needed
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
})

// Create a client for your router
const client: RouterClient<typeof router> = createORPCClient(link)
// Or, create a client using a contract
const client: ContractRouterClient<typeof contract> = createORPCClient(link)
```

:::tip
You can export `RouterClient<typeof router>` and `ContractRouterClient<typeof contract>` from server instead.
:::

## Calling Procedures

Once your client is set up, you can call your [procedures](/docs/procedure) as if they were local functions.

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

const client = {} as RouterClient<typeof router>
// ---cut---
const planet = await client.planet.find({ id: 1 })

client.planet.create
//            ^|
```

## Merge Clients

In oRPC, a client is a simple object-like structure. To merge multiple clients, you simply assign each client to a property in a new object:

```ts
const clientA: RouterClient<typeof routerA> = createORPCClient(linkA)
const clientB: RouterClient<typeof routerB> = createORPCClient(linkB)
const clientC: RouterClient<typeof routerC> = createORPCClient(linkC)

export const orpc = {
  a: clientA,
  b: clientB,
  c: clientC,
}
```

## Utilities

::: info
These utilities can be used for any kind of oRPC client.
:::

### Infer Client Input Map

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientInputMap } from '@orpc/client'

type InputMap = InferClientInputMap<typeof client>

type FindPlanetInput = InputMap['planet']['find']
```

Recursively infers the **input types** from a client. Produces a nested map where each endpoint's input type is preserved.

### Infer Client Body Input Map

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientBodyInputMap } from '@orpc/client'

type BodyInputMap = InferClientBodyInputMap<typeof client>

type FindPlanetBodyInput = BodyInputMap['planet']['find']
```

Recursively infers the **body input types** from a client. If an endpoint's input includes `{ body: ... }`, only the `body` portion is extracted. Produces a nested map of body input types.

### Infer Client Output Map

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientOutputMap } from '@orpc/client'

type OutputMap = InferClientOutputMap<typeof client>

type FindPlanetOutput = OutputMap['planet']['find']
```

Recursively infers the **output types** from a client. Produces a nested map where each endpoint's output type is preserved.

### Infer Client Body Output Map

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientBodyOutputMap } from '@orpc/client'

type BodyOutputMap = InferClientBodyOutputMap<typeof client>

type FindPlanetBodyOutput = BodyOutputMap['planet']['find']
```

Recursively infers the **body output types** from a client. If an endpoint's output includes `{ body: ... }`, only the `body` portion is extracted. Produces a nested map of body output types.

### Infer Client Error Map

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientErrorMap } from '@orpc/client'

type ErrorMap = InferClientErrorMap<typeof client>

type FindPlanetError = ErrorMap['planet']['find']
```

Recursively infers the **error types** from a client. Produces a nested map where each endpoint's error type is preserved.

### Infer Client Error Union

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientErrorUnion } from '@orpc/client'

type AllErrors = InferClientErrorUnion<typeof client>
```

Recursively infers a **union of all error types** from a client. Useful when you want to handle all possible errors from any endpoint at once.

### Infer Client Context

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientContext } from '@orpc/client'

type Context = InferClientContext<typeof client>
```

Infers the client context type from a client.
