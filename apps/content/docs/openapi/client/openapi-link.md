---
title: OpenAPILink
description: Details on using OpenAPILink in oRPC clients.
---

# OpenAPILink

OpenAPILink enables communication with an [OpenAPIHandler](/docs/openapi/openapi-handler) or any API that follows the [OpenAPI Specification](https://swagger.io/specification/) using HTTP/Fetch.

## Installation

::: code-group

```sh [npm]
npm install @orpc/openapi-client@latest
```

```sh [yarn]
yarn add @orpc/openapi-client@latest
```

```sh [pnpm]
pnpm add @orpc/openapi-client@latest
```

```sh [bun]
bun add @orpc/openapi-client@latest
```

```sh [deno]
deno add npm:@orpc/openapi-client@latest
```

:::

## Setup

To use `OpenAPILink`, ensure you have a [contract router](/docs/contract-first/define-contract#contract-router) and that your server is set up with [OpenAPIHandler](/docs/openapi/openapi-handler) or any API that follows the [OpenAPI Specification](https://swagger.io/specification/).

::: info
A normal [router](/docs/router) works as a contract router as long as it does not include a [lazy router](/docs/router#lazy-router). For more advanced use cases, refer to the [Router to Contract](/docs/contract-first/router-to-contract) guide.
:::

```ts twoslash
import { contract } from './shared/planet'
// ---cut---
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { ContractRouterClient } from '@orpc/contract'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'

const link = new OpenAPILink(contract, {
  url: 'http://localhost:3000/api',
  headers: () => ({
    'x-api-key': 'my-api-key',
  }),
  fetch: (request, init) => {
    return globalThis.fetch(request, {
      ...init,
      credentials: 'include', // Include cookies for cross-origin requests
    })
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
})

const client: JsonifiedClient<ContractRouterClient<typeof contract>> = createORPCClient(link)
```

:::warning
Due to JSON limitations, you must wrap your client with `JsonifiedClient` to ensure type safety. Alternatively, follow the [Expanding Type Support for OpenAPI Link](/docs/openapi/advanced/expanding-type-support-for-openapi-link) guide to preserve original types without the wrapper.
:::

## Limitations

Unlike [RPCLink](/docs/client/rpc-link), `OpenAPILink` has some constraints:

- Payloads containing a `Blob` or `File` (outside the root level) must use `multipart/form-data` and serialized using [Bracket Notation](/docs/openapi/bracket-notation).
- For `GET` requests, the payload must be sent as `URLSearchParams` and serialized using [Bracket Notation](/docs/openapi/bracket-notation).

:::warning
In these cases, both the request and response are subject to the limitations of [Bracket Notation Limitations](/docs/openapi/bracket-notation#limitations). Additionally, oRPC converts data to strings (exclude `null` and `undefined` will not be represented).
:::

## CORS policy

`OpenAPILink` requires access to the `Content-Disposition` to distinguish file responses from other responses whe file has a common MIME type like `application/json`, `plain/text`, etc. To enable this, include `Content-Disposition` in your CORS policy's `Access-Control-Expose-Headers`:

```ts
const handler = new OpenAPIHandler(router, {
  plugins: [
    new CORSPlugin({
      exposeHeaders: ['Content-Disposition'],
    }),
  ],
})
```

## Using Client Context

Client context lets you pass extra information when calling procedures and dynamically modify OpenAPILink's behavior.

```ts twoslash
import { contract } from './shared/planet'
// ---cut---
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { ContractRouterClient } from '@orpc/contract'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'

interface ClientContext {
  something?: string
}

const link = new OpenAPILink<ClientContext>(contract, {
  url: 'http://localhost:3000/api',
  headers: async ({ context }) => ({
    'x-api-key': context?.something ?? ''
  })
})

const client: JsonifiedClient<ContractRouterClient<typeof contract, ClientContext>> = createORPCClient(link)

const result = await client.planet.list(
  { limit: 10 },
  { context: { something: 'value' } }
)
```

:::info
If a property in `ClientContext` is required, oRPC enforces its inclusion when calling procedures.
:::

## Lazy URL

You can define `url` as a function, ensuring compatibility with environments that may lack certain runtime APIs.

```ts
const link = new OpenAPILink({
  url: () => {
    if (typeof window === 'undefined') {
      throw new Error('OpenAPILink is not allowed on the server side.')
    }

    return `${window.location.origin}/api`
  },
})
```

## SSE Like Behavior

Unlike traditional SSE, the [Event Iterator](/docs/event-iterator) does not automatically retry on error. To enable automatic retries, refer to the [Client Retry Plugin](/docs/plugins/client-retry).

## Lifecycle

The `OpenAPILink` follows the same lifecycle as the [RPCLink Lifecycle](/docs/client/rpc-link#lifecycle), ensuring consistent behavior across different link types.
