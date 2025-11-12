---
title: RPC Handler
description: Comprehensive Guide to the RPCHandler in oRPC
---

# RPC Handler

The `RPCHandler` enables communication with clients over oRPC's proprietary [RPC protocol](/docs/advanced/rpc-protocol), built on top of HTTP. While it efficiently transfers native types, the protocol is neither human-readable nor OpenAPI-compatible. For OpenAPI support, use the [OpenAPIHandler](/docs/openapi/openapi-handler).

:::warning
`RPCHandler` is designed exclusively for [RPCLink](/docs/client/rpc-link) and **does not** support OpenAPI. Avoid sending requests to it manually.
:::

:::warning
This documentation is focused on the [HTTP Adapter](/docs/adapters/http).
Other adapters may remove or change options to keep things simple.
:::

## Supported Data Types

`RPCHandler` natively serializes and deserializes the following JavaScript types:

- **string**
- **number** (including `NaN`)
- **boolean**
- **null**
- **undefined**
- **Date** (including `Invalid Date`)
- **BigInt**
- **RegExp**
- **URL**
- **Record (object)**
- **Array**
- **Set**
- **Map**
- **Blob** (unsupported in `AsyncIteratorObject`)
- **File** (unsupported in `AsyncIteratorObject`)
- **AsyncIteratorObject** (only at the root level; powers the [Event Iterator](/docs/event-iterator))

:::tip
You can extend the list of supported types by [creating a custom serializer](/docs/advanced/rpc-json-serializer#extending-native-data-types).
:::

## Setup and Integration

```ts
import { RPCHandler } from '@orpc/server/fetch' // or '@orpc/server/node'
import { CORSPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin()
  ],
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
})

export default async function fetch(request: Request) {
  const { matched, response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {} // Provide initial context if required
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
const handler = new RPCHandler(router, {
  filter: ({ contract, path }) => !contract['~orpc'].route.tags?.includes('internal'),
})
```

## Default Plugins

`RPCHandler` automatically enables **essential plugins** for security reasons.

| Plugin                                                   | Applies To                          | Toggle Option                  |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------ |
| [StrictGetMethodPlugin](/docs/plugins/strict-get-method) | [HTTP Adapter](/docs/adapters/http) | `strictGetMethodPluginEnabled` |

::: info
You can safely disable default plugins if they don't provide any meaningful benefit for your use case.
:::

## Lifecycle

```mermaid
sequenceDiagram
  actor A1 as Client
  participant P3 as Request/Response encoder
  participant P4 as Router + Input/Output encoder
  participant P5 as Server-Side Procedure Client

  Note over A1: adaptorInterceptors
  A1 ->> P3: request
  P3 ->> P3: Convert
  Note over P3: rootInterceptors
  P3 ->> P4: standard request
  Note over P4: interceptors
  P4 ->> P4: Find procedure
  P4 ->> A1: If not matched
  P4 ->> P4: Load body + decode request
  P4 ->> P3: if invalid request
  P3 ->> A1: response
  P4 ->> P5: Input, Signal, LastEventId,...
  Note over P5: clientInterceptors
  P5 ->> P5: Handle
  P5 ->> P4: if success
  P4 ->> P4: Encode output
  P5 ->> P4: if failed
  Note over P4: end interceptors
  P4 ->> P4: Encode error
  P4 ->> P3: standard response
  P3 ->> A1: response
```

::: tip
Interceptors can be used to intercept and modify the lifecycle at various stages.
:::

:::info

- The Server-side Procedure Client is a [Server-Side Client](/docs/client/server-side), and `clientInterceptors` are the same as [Server-Side Client Interceptors](/docs/client/server-side#lifecycle).
- Some `RPCHandler` implementations may omit the `Request/Response encoder` when it's not required.

:::
