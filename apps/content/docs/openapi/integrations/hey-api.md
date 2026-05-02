---
title: Hey API Integration
description: Generate oRPC contracts from OpenAPI with Hey API or adapt a Hey API generated client into an oRPC client.
---

# Hey API Integration

[Hey API](https://heyapi.dev/) can be integrated with oRPC in two ways, depending on what you start with:

- Generate an oRPC contract from an existing OpenAPI specification.
- Convert an existing Hey API generated client directly into an oRPC client.

::: warning
The [Hey API](https://heyapi.dev/) integration is still unstable. As Hey API continues to evolve, this integration may introduce breaking changes in the future.
:::

## Convert OpenAPI to an oRPC Contract

If you already have an OpenAPI specification, you can use Hey API to generate an oRPC contract. See [OpenAPI to Contract](/docs/openapi/openapi-to-contract) for the complete setup and next steps.

Once generated, you can use the contract to:

- Implement the contract on your own server with [Implement Contract](/docs/contract-first/implement-contract).
- Create a type-safe client with [OpenAPILink](/docs/openapi/client/openapi-link).
- Use the generated contract as a reference alongside [Define Contract](/docs/contract-first/define-contract) to better understand its structure.

## Convert a Hey API Client Directly to an oRPC Client

If you already have a generated [Hey API client](https://heyapi.dev/openapi-ts/output) and want to use it as an oRPC client without generating a contract first, use `toORPCClient`.

```ts
import { experimental_toORPCClient } from '@orpc/hey-api'
import * as sdk from 'src/client/sdk.gen'

export const client = experimental_toORPCClient(sdk)

const { body } = await client.listPlanets()
```

This `client` behaves like any standard oRPC [server-side client](/docs/client/server-side) or [client-side client](/docs/client/client-side), so you can use it with any oRPC-compatible library.

### Error Handling

Internally, oRPC passes the `throwOnError` option to the Hey API client. If the original Hey API client throws an error, oRPC forwards it as is, ensuring consistent error handling.
