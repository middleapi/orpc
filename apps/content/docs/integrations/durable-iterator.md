---
title: Durable Iterator Integration
description: Extends Event Iterator with durable event streams, automatic reconnections, and event recovery through a separate streaming service.
---

# Durable Iterator Integration

Durable Iterator extends [Event Iterator](/docs/event-iterator) by offloading streaming to a separate service that provides durable event streams, automatic reconnections, and event recovery.

::: info
See the complete example in our [Cloudflare Worker Playground](/docs/playgrounds).
:::

::: info
While not limited to [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/), it's currently the only supported implementation.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-durable-iterator@latest
```

```sh [yarn]
yarn add @orpc/experimental-durable-iterator@latest
```

```sh [pnpm]
pnpm add @orpc/experimental-durable-iterator@latest
```

```sh [bun]
bun add @orpc/experimental-durable-iterator@latest
```

```sh [deno]
deno add npm:@orpc/experimental-durable-iterator@latest
```

:::

::: warning
The `experimental-` prefix indicates that this feature is still in development and may change in the future.
:::

## Durable Object

::: warning
This section requires you to be familiar with [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/). Please learn it first before continuing.
:::

### Define your Durable Object

Simply extend the `DurableIteratorObject` class:

```ts
import { DurableIteratorObject } from '@orpc/experimental-durable-iterator/durable-object'

export class ChatRoom extends DurableIteratorObject<{ message: string }> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      signingKey: 'secret-key', // Replace with your actual signing key
      interceptors: [
        onError(e => console.error(e)), // log error thrown from rpc calls
      ],
      onSubscribed: (websocket, lastEventId) => {
        console.log(`WebSocket Ready id=${websocket['~orpc'].deserializeId()}`)
      }
    })
  }

  someMethod() {
    // publishEvent method inherited from DurableIteratorObject
    this.publishEvent({ message: 'Hello, world!' })
  }
}
```

::: info
How to use `DurableIteratorObject` without extending it: [see here](https://github.com/middleapi/orpc/tree/main/packages/durable-iterator/src/durable-object/object.ts)
:::

### Upgrade Durable Iterator Request

Upgrade and validate WebSocket requests to your Durable Object by providing a signing key and the corresponding namespace:

```ts
import { upgradeDurableIteratorRequest } from '@orpc/experimental-durable-iterator/durable-object'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/chat-room') {
      return upgradeDurableIteratorRequest(request, {
        signingKey: 'secret-key', // Replace with your actual signing key
        namespace: env.CHAT_ROOM,
      })
    }

    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>

export { ChatRoom }
```

### Publish Events

Use `publishEvent` to send events to connected clients. Three filtering options are available:

- **`tags`**: Send events only to clients with matching tags
- **`targets`**: Send events to specific clients (accepts array or filter callback)
- **`exclude`**: Exclude specific clients from receiving events (accepts array or filter callback)

```ts
this.publishEvent({ message: 'Hello, world!' }, {
  tags: ['tag1', 'tag2'],
  targets: ws => ws['~orpc'].deserializeTokenPayload().att.role === 'admin',
  exclude: [senderWs],
})
```

::: info
When using [Resume Events After Connection Loss](#resume-events-after-connection-loss) feature, prefer `tags` or `targets` filtering over `exclude` for security. Since clients control their own identity, `exclude` should only be used for UI convenience, not security enforcement.
:::

### Resume Events After Connection Loss

Event resumption is disabled by default. Enable it by configuring `resumeRetentionSeconds` to specify how long events are persisted for recovery:

```ts
export class YourDurableObject extends DurableIteratorObject<{ message: string }> {
  constructor(
    ctx: DurableObjectState,
    env: Env,
  ) {
    super(ctx, env, {
      signingKey: 'secret-key',
      resumeRetentionSeconds: 60 * 2, // 2 minutes [!code highlight]
    })
  }
}
```

::: warning
This feature controls event IDs automatically, so custom event IDs will be ignored:

```ts
import { withEventMeta } from '@orpc/experimental-durable-iterator'

this.publishEvent(withEventMeta({ message: 'Hello, world!' }, { id: 'this-will-not-take-effect' }))
```

:::

## Server Side

Define two procedures: one for listening to chat room messages, and another for sending messages to all connected clients:

::: info
This example assumes your server and Durable Object run in the same environment. For different environments, send a fetch request to your Durable Object instead of invoking methods directly.
:::

```ts
import { DurableIterator } from '@orpc/experimental-durable-iterator'

export const router = {
  onMessage: base.handler(({ context }) => {
    return new DurableIterator<ChatRoom>('some-room', {
      tags: ['tag1', 'tag2'],
      signingKey: 'secret-key', // Replace with your actual signing key
    })
  }),

  sendMessage: base
    .input(z.object({ message: z.string() }))
    .handler(async ({ context, input }) => {
      const id = context.env.CHAT_ROOM.idFromName('some-room')
      const stub = context.env.CHAT_ROOM.get(id)

      await stub.publishEvent(input)
    }),
}
```

Enable Durable Iterator support by adding `DurableIteratorHandlerPlugin` to your handler:

```ts
import { DurableIteratorHandlerPlugin } from '@orpc/experimental-durable-iterator'

const handler = new RPCHandler(router, {
  plugins: [
    new DurableIteratorHandlerPlugin(),
  ],
})
```

::: warning CORS Policy
The `DurableIteratorHandlerPlugin` adds an `x-orpc-durable-iterator` header to responses, indicating that the response contains a durable iterator. For cross-origin requests, you must configure CORS to expose this header to clients.

```ts
const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin({
      exposeHeaders: ['x-orpc-durable-iterator'], // [!code highlight]
    }),
    new DurableIteratorHandlerPlugin(),
  ],
})
```

:::

## Client Side

On the client side, simply configure the plugin. Usage is identical to [Event Iterator](/docs/client/event-iterator). The `url` in `DurableIteratorLinkPlugin` points to your Durable Object upgrade endpoint:

```ts
import { DurableIteratorLinkPlugin } from '@orpc/experimental-durable-iterator/client'

const link = new RPCLink({
  url: 'http://localhost:3000/rpc',
  plugins: [
    new DurableIteratorLinkPlugin({
      url: 'ws://localhost:3000/chat-room',
      interceptors: [
        onError(e => console.error(e)), // log error thrown from rpc calls
      ],
    }),
  ],
})
```

::: info
`DurableIteratorLinkPlugin` establishes a WebSocket connection to the Durable Object for each durable iterator and automatically reconnects if the connection is lost.
:::

### Example

```ts
const iterator = await client.onMessage()

for await (const { message } of iterator) {
  console.log('Received message:', message)
}

await client.sendMessage({ message: 'Hello, world!' })
```

### Auto Refresh Token Before Expiration

Token auto-refresh is disabled by default. Enable it by configuring `refreshTokenBeforeExpireInSeconds`:

```ts
const link = new RPCLink({
  url: 'http://localhost:3000/rpc',
  plugins: [
    new DurableIteratorLinkPlugin({
      url: 'ws://localhost:3000/chat-room',
      refreshTokenBeforeExpireInSeconds: 10 * 60, // 10 minutes [!code highlight]
    }),
  ],
})
```

::: warning
Token refresh reuses the existing WebSocket connection if the refreshed token has identical `chn` (channel) and `tags`. Otherwise, the connection closes and a new one is established.
:::

### Stopping the Durable Iterator

Like [Event Iterator](/docs/client/event-iterator), you can rely on `signal` or `.return` to stop the iterator.

```ts
const controller = new AbortController()
const iterator = await client.onMessage(undefined, { signal: controller.signal })

// Stop the iterator after 1 second
setTimeout(() => {
  controller.abort()
  // or
  iterator.return()
}, 1000)

for await (const { message } of iterator) {
  console.log('Received message:', message)
}
```

## Method RPC

Unlike [Cloudflare Durable Objects RPC](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) (server-side only), this RPC uses oRPC's built-in system over the same WebSocket connection for fast client-to-Durable Object communication. Define methods that accept a `DurableIteratorWebsocket` instance as the first argument and return an [oRPC Client](/docs/client/server-side):

```ts
import { DurableIteratorWebsocket } from '@orpc/experimental-durable-iterator/durable-object'

export class ChatRoom extends DurableIteratorObject<{ message: string }> {
  singleClient(ws: DurableIteratorWebsocket) {
    return base
      .input(z.object({ message: z.string() }))
      .handler(({ input, context }) => {
        const tokenPayload = ws['~orpc'].deserializeTokenPayload()

        this.publishEvent(input, {
          exclude: [ws], // exclude the sender
        })
      })
      .callable()
  }

  routerClient(ws: DurableIteratorWebsocket) {
    return {
      ping: base.handler(() => 'pong').callable(),
      echo: base
        .input(z.object({ text: z.string() }))
        .handler(({ input }) => `Echo: ${input.text}`)
        .callable(),
    }
  }
}
```

### Server Side Usage

```ts
import { DurableIterator } from '@orpc/experimental-durable-iterator'

export const onMessage = base.handler(({ context }) => {
  return new DurableIterator<ChatRoom>('some-room', {
    signingKey: 'secret-key', // Replace with your actual signing key
    att: { // Attach additional data to token
      userId: 'user-123',
    },
  }).rpc('singleClient', 'routerClient') // Allowed methods
})
```

::: info
Clients can only call methods defined in the `rpc` method, providing fine-grained access control.
:::

::: warning
The `att` (attachment) data is visible to clients. Only include non-sensitive metadata like user IDs or preferences.
:::

### Client Side Usage

Invoke methods defined in `rpc` directly from the client iterator:

```ts
const iterator = await client.onMessage()

// Listen for events
for await (const { message } of iterator) {
  console.log('Received message:', message)
}

// Call RPC methods
await iterator.singleClient({ message: 'Hello, world!' })

// Call nested router methods
const response = await iterator.routerClient.ping()
console.log(response) // "pong"

const echoResponse = await iterator.routerClient.echo({ text: 'Hello' })
console.log(echoResponse) // "Echo: Hello"
```

::: info
[Retry Plugin](/docs/plugins/client-retry) is enabled for all RPC methods. Configure retry attempts using the context:

```ts
await iterator.singleClient({ message: 'Hello, world!' }, { context: { retry: 3 } })
```

:::

## Contract First

This integration supports [Contract First](/docs/contract-first/define-contract). Define an interface that extends `DurableIteratorObject`:

```ts
import type { ContractRouterClient } from '@orpc/contract'
import { oc, type } from '@orpc/contract'
import type { ClientDurableIterator } from '@orpc/experimental-durable-iterator/client'
import type { DurableIteratorObject } from '@orpc/experimental-durable-iterator'

export const publishMessageContract = oc.input(z.object({ message: z.string() }))

export interface ChatRoom extends DurableIteratorObject<{ message: string }> {
  publishMessage(...args: any[]): ContractRouterClient<typeof publishMessageContract>
}

export const contract = {
  onMessage: oc.output(type<ClientDurableIterator<ChatRoom, 'publishMessage'>>()),
}
```

## Advanced

Durable Iterator is built on top of the [Hibernation Plugin](/docs/plugins/hibernation), essentially providing an oRPC instance within another oRPC. This architecture gives you access to the full oRPC ecosystem, including interceptors and plugins for both server and client sides.

### Server-Side Customization

```ts
export class YourDurableObject extends DurableIteratorObject<{ message: string }> {
  constructor(
    ctx: DurableObjectState,
    env: Env,
  ) {
    super(ctx, env, {
      signingKey: 'secret-key',
      customJsonSerializers: [], // Custom JSON serializers
      interceptors: [], // Handler interceptors
      plugins: [], // Handler plugins
    })
  }
}
```

### Client-Side Customization

```ts
declare module '@orpc/experimental-durable-iterator/client' {
  interface ClientDurableIteratorRpcContext {
    // Custom client context
  }
}

const link = new RPCLink({
  url: 'http://localhost:3000/rpc',
  plugins: [
    new DurableIteratorLinkPlugin({
      url: 'ws://localhost:3000/chat-room',
      customJsonSerializers: [], // Custom JSON serializers
      interceptors: [], // Link interceptors
      plugins: [], // Link plugins
    }),
  ],
})
```
