# Publisher Helpers

Publisher helpers provide a unified way to publish and subscribe to events across different storage backends in oRPC applications. They support both static and dynamic event names, along with optional resume support so subscribers can catch up on missed events.

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

| Name                | Resume Support | Adapter for                                                                      |
| ------------------- | -------------- | -------------------------------------------------------------------------------- |
| `MemoryPublisher`   | ✅             | In-memory storage                                                                |
| `RedisPublisher`    | ✅             | [Redis](https://github.com/redis/redis)                                          |
| `UpstashPublisher`  | ✅             | [Upstash Redis](https://github.com/upstash/redis-js)                             |
| `BunRedisPublisher` | ✅             | [Bun's Redis](https://bun.com/docs/runtime/redis)                                |
| `DurablePublisher`  | ✅             | [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) |

::: code-group

```ts [memory]
import { MemoryPublisher } from '@orpc/publisher/memory'

const publisher = new MemoryPublisher<Events>({
  resume: {
    /**
     * Whether event resume support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: false,

    /**
     * How long (in seconds) to retain events for resume.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds: 300
  }
})
```

```ts [redis]
import { createClient } from 'redis'
import { RedisPublisher } from '@orpc/publisher/redis'

const client = createClient({ url: 'redis://localhost:6379' })

// RedisRateLimiter lazily connects to Redis when needed.
// You can still call `client.connect()` manually, but it is optional.
await client.connect()

const publisher = new RedisPublisher<Events>(client, {
  /**
   * Redis subscriber instance.
   * Pub/Sub takes over the connection, so a client with subscriptions
   * cannot execute commands and must use a dedicated connection.
   *
   * @default redis.duplicate()
   */
  subscriber: redis.duplicate(),

  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix: '',

  /**
   * Serializer for serialize and deserialize payloads.
   *
   * @default RPCSerializer
   */
  serializer: undefined,

  resume: {
    /**
     * Whether event resume support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: false,

    /**
     * How long (in seconds) to retain events for resume.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds: 300
  }
})
```

```ts [upstash]
import { Redis } from '@upstash/redis'
import { UpstashPublisher } from '@orpc/publisher/upstash'

const redis = Redis.fromEnv()

const publisher = new UpstashPublisher<Events>(redis, {
  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix: '',

  /**
   * Serializer for serialize and deserialize payloads.
   *
   * @default RPCSerializer
   */
  serializer: undefined,

  resume: {
    /**
     * Whether event resume support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: false,

    /**
     * How long (in seconds) to retain events for resume.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds: 300
  }
})
```

```ts [bun]
import { BunRedisPublisher } from '@orpc/bun'
import { redis } from 'bun'

const publisher = new BunRedisPublisher<Events>(redis, {
  /**
   * Redis subscriber instance.
   * Pub/Sub takes over the connection, so a client with subscriptions
   * cannot execute commands and must use a dedicated connection.
   *
   * @default redis.duplicate() (lazily created on first listen)
   */
  subscriber: redis.duplicate(),

  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix: '',

  /**
   * Serializer for serialize and deserialize payloads.
   *
   * @default RPCSerializer
   */
  serializer: undefined,

  resume: {
    /**
     * Whether event resume support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: false,

    /**
     * How long (in seconds) to retain events for resume.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds: 300
  }
})
```

```ts [cloudflare]
import { DurablePublisher, DurablePublisherObject } from '@orpc/cloudflare'

export class PublisherDO extends DurablePublisherObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      resume: {
        /**
         * Whether event resume support is enabled.
         *
         * When enabled, published events are temporarily stored so new
         * subscribers can resume from a previous position using `lastEventId`.
         *
         * @default false
         */
        enabled: false,

        /**
         * How long (in seconds) to retain events for resume.
         *
         * Expired events are cleaned up lazily for performance reasons, so
         * some events may remain available slightly longer than this period.
         *
         * @default 300 (5 min)
         */
        seconds: 300,

        /**
         * Interval (in seconds) between cleanup checks for the Durable Object.
         *
         * At each interval, verify whether the Durable Object is inactive
         * (no active WebSocket connections and no stored events). If inactive, all
         * data is deleted to free resources; otherwise, another check is scheduled.
         *
         * @default 6 * 60 * 60 (6 hours)
         */
        cleanupIntervalSeconds: 6 * 60 * 60,

        /**
         * Prefix for the resume storage table schema.
         * Used to avoid naming conflicts with other tables in the same Durable Object.
         *
         * @default 'orpc:'
         */
        schemaPrefix: 'orpc:'
      }
    })
  }
}

export default {
  async fetch(request, env) {
    const publisher = new DurablePublisher<Events>(env.PUBLISHER_DON, {
      /**
       * Prefix for events, to avoid naming conflicts with other publishers in the same Durable Object Namespace.
       *
       * @default ''
       */
      prefix: '',

      /**
       * Serializer for serialize and deserialize payloads.
       *
       * @default RPCSerializer
       */
      serializer: undefined,

      /**
       * Custom function to get the Durable Object stub for publishing.
       *
       * @default ((namespace, event) => namespace.getByName(event))
       */
      getStubByName: (namespace, event) => namespace.getByName(event)
    })
  },
}
```

:::

## Resume Missing Events

Some adapters can resume events missed while a subscriber is offline. This feature is usually disabled by default, but you can enable it when creating the publisher. When enabled, the publisher automatically manages event ids and attempts to deliver events since the last event id provided by the subscriber.

```ts
const publisher = new MemoryPublisher({
  resume: {
    enabled: true, // Enable resuming missed events
    seconds: 60 * 5, // TTL in seconds
  }
})

const iterator = publisher.subscribe('something-updated', {
  signal,
  lastEventId, // The publisher will attempt to deliver missed events since this event id
})
```

::: warning
When resume is enabled, the publisher manages event ids automatically. This means:

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
