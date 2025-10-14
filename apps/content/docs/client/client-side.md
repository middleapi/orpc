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

### Infer Client Inputs

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientInputs } from '@orpc/client'

type Inputs = InferClientInputs<typeof client>

type FindPlanetInput = Inputs['planet']['find']
```

Recursively infers the **input types** from a client. Produces a nested map where each endpoint's input type is preserved.

### Infer Client Body Inputs

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientBodyInputs } from '@orpc/client'

type BodyInputs = InferClientBodyInputs<typeof client>

type FindPlanetBodyInput = BodyInputs['planet']['find']
```

Recursively infers the **body input types** from a client. If an endpoint's input includes `{ body: ... }`, only the `body` portion is extracted. Produces a nested map of body input types.

### Infer Client Outputs

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientOutputs } from '@orpc/client'

type Outputs = InferClientOutputs<typeof client>

type FindPlanetOutput = Outputs['planet']['find']
```

Recursively infers the **output types** from a client. Produces a nested map where each endpoint's output type is preserved.

### Infer Client Body Outputs

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientBodyOutputs } from '@orpc/client'

type BodyOutputs = InferClientBodyOutputs<typeof client>

type FindPlanetBodyOutput = BodyOutputs['planet']['find']
```

Recursively infers the **body output types** from a client. If an endpoint's output includes `{ body: ... }`, only the `body` portion is extracted. Produces a nested map of body output types.

### Infer Client Errors

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientErrors } from '@orpc/client'

type Errors = InferClientErrors<typeof client>

type FindPlanetError = Errors['planet']['find']
```

Recursively infers the **error types** from a client when using [type-safe error handling](/docs/error-handling#type‐safe-error-handling). Produces a nested map where each endpoint's error type is preserved.

### Infer Client Error Union

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientErrorUnion } from '@orpc/client'

type AllErrors = InferClientErrorUnion<typeof client>
```

Recursively infers a **union of all error types** from a client when using [type-safe error handling](/docs/error-handling#type‐safe-error-handling). Useful when you want to handle all possible errors from any endpoint at once.

### Infer Client Context

```ts twoslash
import type { orpc as client } from './shared/planet'
// ---cut---
import type { InferClientContext } from '@orpc/client'

type Context = InferClientContext<typeof client>
```

Infers the client context type from a client.
