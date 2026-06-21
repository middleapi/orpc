# Scaling Large Projects

A single root [client](/docs/client/client-side) is a great way to get started. As your project grows, though, it can lead to type performance issues and tangled dependencies. Splitting the client into smaller service-level clients can help for a while, but very large codebases can still outgrow that approach.

This guide shows an alternative pattern for large projects: import and use individual [procedure contracts](/docs/contract/procedure) directly.

## Requirements

This pattern depends on one consistency rule: every [procedure contract](/docs/contract/procedure) must define `meta.path`, and that path must exactly match the procedure's location in the root contract.

```ts
import { meta, oc } from '@orpc/contract'

export const procedure = oc
  .meta(meta.path(['real', 'path', 'to', 'procedure']))
  .input(z.object({ name: z.string() }))
  .output(z.object({ message: z.string() }))
```

If you use `['real', 'path', 'to', 'procedure']` as the path, the procedure must be mounted at `real.path.to.procedure` in the root contract. This is required for the pattern to work correctly:

```ts
import { procedure } from './path/to/procedure'

const router = {
  real: {
    path: {
      to: {
        procedure,
      },
    },
  }
}
```

## Contract Caller

This pattern does not require a single root client. Instead, you configure a caller that communicates with the server. `createContractCaller` accepts an [RPC Link](/docs/rpc/link), an [OpenAPI Link](/docs/openapi/link), or a custom link. It also accepts options similar to [`createORPCClient`](/docs/client/client-side), but with less typesafe because the full contract is not known up front:

```ts
import { createContractCaller } from '@orpc/contract'

export const call = createContractCaller(link, { /** options */})
```

::: warning
If you are using [OpenAPI Link](/docs/openapi/link), or any link that requires the client to be wrapped in `JsonifiedClient`, use `createContractJsonifiedCaller` from `@orpc/openapi` instead of `createContractCaller`.
:::

You can then call a procedure by importing its contract directly in the client:

```ts
import { procedure } from './path/to/procedure'

const output = await call(procedure, input, {/** options */})
```

### `contractRef`

Some integrations still need a root contract. For example, [OpenAPI Link](/docs/openapi/link) and some plugins depend on one. In those cases, `contractRef` can help:

```ts
import { RouterContract } from '@orpc/contract'

const contractRef: RouterContract = {}

const link = new OpenAPILink(contractRef, {
  plugins: [
    new PluginRequireContract(contractRef)
  ]
})

export const call = createContractCaller(link, { contractRef })
```

The idea behind `contractRef` is simple: every time `call` is used, the caller automatically registers the called procedure contract into `contractRef` at the path defined by `meta.path`.

::: info
Some features may not support `contractRef` well. In those cases, import the root contract instead and cast it with `as any` when needed.
:::

## TanStack Query Integration

[TanStack Query Integration](/docs/integrations/tanstack-query) also supports this pattern. First, create a factory that accepts a [contract caller](#contract-caller) and options similar to the [TanStack Query interceptor options](/docs/integrations/tanstack-query#interceptors), but with less type safety because the full contract is not known up front:

```ts
import { createContractUtilsFactory } from '@orpc/tanstack-query'

export const createUtils = createContractUtilsFactory(call, { /** options */})
```

::: warning
If you are using [OpenAPI Link](/docs/openapi/link), or any link that requires the client to be wrapped in `JsonifiedClient`, use `createContractJsonifiedUtilsFactory` from `@orpc/tanstack-query` instead of `createContractUtilsFactory`.
:::

You can then create utilities for each procedure contract:

```ts
import { procedure } from './path/to/procedure'

const utils = createUtils(procedure)

const query = useQuery(utils.queryOptions({/** options */}))
```
