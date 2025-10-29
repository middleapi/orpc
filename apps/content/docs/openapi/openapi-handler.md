---
title: OpenAPI Handler
description: Comprehensive Guide to the OpenAPIHandler in oRPC
---

# OpenAPI Handler

The `OpenAPIHandler` enables communication with clients over RESTful APIs, adhering to the OpenAPI specification. It is fully compatible with [OpenAPILink](/docs/openapi/client/openapi-link) and the [OpenAPI Specification](/docs/openapi/openapi-specification).

## Supported Data Types

`OpenAPIHandler` serializes and deserializes the following JavaScript types:

- **string**
- **number** (`NaN` → `null`)
- **boolean**
- **null**
- **undefined** (`undefined` in arrays → `null`)
- **Date** (`Invalid Date` → `null`)
- **BigInt** (`BigInt` → `string`)
- **RegExp** (`RegExp` → `string`)
- **URL** (`URL` → `string`)
- **Record (object)**
- **Array**
- **Set** (`Set` → `array`)
- **Map** (`Map` → `array`)
- **Blob** (unsupported in `AsyncIteratorObject`)
- **File** (unsupported in `AsyncIteratorObject`)
- **AsyncIteratorObject** (only at the root level; powers the [Event Iterator](/docs/event-iterator))

::: warning
If a payload contains `Blob` or `File` outside the root level, it must use `multipart/form-data`. In such cases, oRPC applies [Bracket Notation](/docs/openapi/bracket-notation) and converts other types to strings (exclude `null` and `undefined` will not be represented).
:::

:::tip
You can extend the list of supported types by [creating a custom serializer](/docs/openapi/advanced/openapi-json-serializer#extending-native-data-types).
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/openapi@latest
```

```sh [yarn]
yarn add @orpc/openapi@latest
```

```sh [pnpm]
pnpm add @orpc/openapi@latest
```

```sh [bun]
bun add @orpc/openapi@latest
```

```sh [deno]
deno add npm:@orpc/openapi@latest
```

:::

## Setup and Integration

```ts
import { OpenAPIHandler } from '@orpc/openapi/fetch' // or '@orpc/server/node'
import { CORSPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'

const handler = new OpenAPIHandler(router, {
  plugins: [new CORSPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export default async function fetch(request: Request) {
  const { matched, response } = await handler.handle(request, {
    prefix: '/api',
    context: {} // Add initial context if needed
  })

  if (matched) {
    return response
  }

  return new Response('Not Found', { status: 404 })
}
```

## Filtering Procedures

You can filter a procedure from matching by using the `filter` option:

```ts
const handler = new OpenAPIHandler(router, {
  filter: ({ contract, path }) => !contract['~orpc'].route.tags?.includes('internal'),
})
```

## Event Iterator Keep Alive

To keep [Event Iterator](/docs/event-iterator) connections alive, `OpenAPIHandler` periodically sends a ping comment to the client. You can configure this behavior using the following options:

- `eventIteratorKeepAliveEnabled` (default: `true`) – Enables or disables pings.
- `eventIteratorKeepAliveInterval` (default: `5000`) – Time between pings (in milliseconds).
- `eventIteratorKeepAliveComment` (default: `''`) – Custom content for ping comments.

```ts
const handler = new OpenAPIHandler(router, {
  eventIteratorKeepAliveEnabled: true,
  eventIteratorKeepAliveInterval: 5000, // 5 seconds
  eventIteratorKeepAliveComment: '',
})
```

## Lifecycle

The `OpenAPIHandler` follows the same lifecycle as the [RPCHandler Lifecycle](/docs/rpc-handler#lifecycle), ensuring consistent behavior across different handler types.
