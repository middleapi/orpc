# Publisher Helpers

Publisher helpers provide a unified way to publish and subscribe to events across different storage backends in oRPC applications. They support both static and dynamic event names, along with optional replay of missed events for subscribers.

## Installation

::: code-group

```sh [npm]
npm install @orpc/publisher@beta
```

```sh [yarn]
yarn add @orpc/publisher@beta
```

```sh [pnpm]
pnpm add @orpc/publisher@beta
```

```sh [bun]
bun add @orpc/publisher@beta
```

```sh [deno]
deno add npm:@orpc/publisher@beta
```

:::

## Basic Usage

The core concept is the `Publisher` interface, which defines a standard way to publish events and subscribe to them. You can create your own publisher or use one of the provided adapters for popular storage backends. The `publish` method accepts an event name and payload, while `subscribe` lets you listen to specific events using either callback or iterator styles.

```ts twoslash
import { MemoryPublisher } from '@orpc/publisher/memory'
import { os } from '@orpc/server'
import * as z from 'zod'
// ---cut---
const publisher = new MemoryPublisher<{
  'something-updated': {
    id: string
  }
}>()

const live = os
  .handler(async function* ({ input, signal, lastEventId }) {
    const iterator = publisher.subscribe('something-updated', { signal, lastEventId })
    for await (const payload of iterator) {
      // Handle payload here or yield directly to client
      yield payload
    }
  })

const publish = os
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    await publisher.publish('something-updated', { id: input.id })
  })
```

::: tip
The publisher supports both static and dynamic event names.

```ts
const publisher = new MemoryPublisher<Record<string, { message: string }>>()
```

:::

## Adapters

| Name                | Replay Support | Adapter for                                          |
| ------------------- | -------------- | ---------------------------------------------------- |
| `MemoryPublisher`   | ✅             | In-memory storage                                    |
| `RedisPublisher`    | ✅             | [Redis](https://github.com/redis/redis)              |
| `UpstashPublisher`  | ✅             | [Upstash Redis](https://github.com/upstash/redis-js) |
| `BunRedisPublisher` | ✅             | [Bun's Redis](https://bun.com/docs/runtime/redis)    |

::: code-group

```ts [memory]
import { MemoryPublisher } from '@orpc/publisher/memory'
```

```ts [redis]
import { createClient } from 'redis'
import { RedisPublisher } from '@orpc/publisher/redis'

const client = createClient({ url: 'redis://localhost:6379' })

// RedisRateLimiter lazily connects to Redis when needed.
// You can still call `client.connect()` manually, but it is optional.
await client.connect()

const publisher = new RedisPublisher(client, {
  subscriber: client.duplicate(), // Redis client for subscribing to pub/sub (default: client.duplicate())
  prefix: 'orpc:', // Optional Redis key prefix
  serializer: undefined, // Optional custom serializer
})
```

```ts [upstash]
import { Redis } from '@upstash/redis'
import { UpstashPublisher } from '@orpc/publisher/upstash'

const redis = Redis.fromEnv()

const publisher = new UpstashPublisher(redis, {
  prefix: 'orpc:', // Optional Redis key prefix
  serializer: undefined, // Optional custom serializer
})
```

```ts [bun-redis]
import { BunRedisPublisher } from '@orpc/bun'
import { redis } from 'bun'

const publisher = new BunRedisPublisher(redis, {
  subscriber: redis.duplicate(), // Redis client for subscribing to pub/sub (default: redis.duplicate())
  prefix: 'orpc:', // Optional Redis key prefix
  serializer: undefined, // Optional custom serializer
})
```

:::

## Replay Missing Events

Some adapters can replay events missed while a subscriber is offline. This feature is usually disabled by default, but you can enable it when creating the publisher. When enabled, the publisher automatically manages event ids and attempts to replay events since the last event id provided by the subscriber.

```ts
const publisher = new MemoryPublisher({
  replay: {
    enabled: true, // Enable replaying missed events
    seconds: 60 * 5, // TTL in seconds
  }
})

const iterator = publisher.subscribe('something-updated', {
  signal,
  lastEventId, // The publisher will attempt to replay missed events since this event id
})
```

::: warning
When replay is enabled, the publisher manages event ids automatically. This means:

- Any event id provided during publishing is ignored
- When subscribing, you must preserve and forward the event id when yielding custom payloads

```ts
import { getEventMeta, withEventMeta } from '@orpc/server'

const live = os
  .handler(async function* ({ input, signal, lastEventId }) {
    const iterator = publisher.subscribe('something-updated', { signal, lastEventId })
    for await (const payload of iterator) {
      // Preserve event id when yielding custom payloads
      const id = getEventMeta(payload)?.id
      yield withEventMeta({ custom: 'value' }, { id })
    }
  })

const publish = os
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    // The event id 'this-will-be-ignored' will be replaced by the publisher
    await publisher.publish(
      'something-updated',
      withEventMeta({ id: input.id }, { id: 'this-will-be-ignored' })
    )
  })
```

:::

### Client Reconnection

On the client, you can use the [Retry Plugin](/docs/plugins/retry), which automatically controls and passes `lastEventId` to the server when reconnecting. Alternatively, you can manage `lastEventId` manually:

```ts
import { getEventMeta } from '@orpc/client'

let lastEventId: string | undefined

while (true) {
  try {
    const iterator = await client.live('input', { lastEventId })

    for await (const payload of iterator) {
      lastEventId = getEventMeta(payload)?.id // Update lastEventId

      console.log(payload)
    }
  }
  catch {
    await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second before retrying
  }
}
```
