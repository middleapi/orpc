---
title: Publisher
description: Listen and publish events with resuming support in oRPC
---

# Publisher

The Publisher is a helper that enables you to listen to and publish events to subscribers. Combined with the [Event Iterator](/docs/client/event-iterator), it allows you to build streaming responses, real-time updates, and server-sent events with minimal requirements.

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-publisher@latest
```

```sh [yarn]
yarn add @orpc/experimental-publisher@latest
```

```sh [pnpm]
pnpm add @orpc/experimental-publisher@latest
```

```sh [bun]
bun add @orpc/experimental-publisher@latest
```

```sh [deno]
deno add npm:@orpc/experimental-publisher@latest
```

:::

## Basic Usage

```ts twoslash
import { MemoryPublisher } from '@orpc/experimental-publisher/memory'
import { os } from '@orpc/server'
import * as z from 'zod'
// ---cut---
const publisher = new MemoryPublisher<{
  'something-updated': {
    id: string
  }
}>()

const live = os
  .handler(async function* ({ input, signal }) {
    const iterator = publisher.subscribe('something-updated', { signal })
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

## Resume Feature

The resume feature uses `lastEventId` to determine where to resume from after a disconnection.

::: warning
By default, most adapters have this feature disabled.
:::

### Server Implementation

When subscribing, you must forward the `lastEventId` to the publisher to enable resuming:

```ts
const live = os
  .handler(async function* ({ input, signal, lastEventId }) {
    const iterator = publisher.subscribe('something-updated', { signal, lastEventId })
    for await (const payload of iterator) {
      yield payload
    }
  })
```

::: warning Event ID Management
The publisher automatically manages event ids when resume is enabled. This means:

- Event ids you provide when publishing will be ignored
- When subscribing, you must forward the event id when yielding custom payloads

```ts
import { getEventMeta, withEventMeta } from '@orpc/server'

const live = os
  .handler(async function* ({ input, signal, lastEventId }) {
    const iterator = publisher.subscribe('something-updated', { signal, lastEventId })
    for await (const payload of iterator) {
      // Preserve event id when yielding custom data
      yield withEventMeta({ custom: 'value' }, { ...getEventMeta(payload) })
    }
  })

const publish = os
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    // The event id 'this-will-be-ignored' will be replaced by the publisher
    await publisher.publish('something-updated', withEventMeta({ id: input.id }, { id: 'this-will-be-ignored' }))
  })
```

:::

### Client Implementation

On the client, you can use the [Client Retry Plugin](/docs/plugins/client-retry), which automatically controls and passes `lastEventId` to the server when reconnecting. Alternatively, you can manage `lastEventId` manually:

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

## Available Adapters

| Name                     | Resume Support | Description                                                                                  |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------------- |
| `MemoryPublisher`        | ✅             | A simple in-memory publisher                                                                 |
| `IORedisPublisher`       | ✅             | Adapter for [ioredis](https://github.com/redis/ioredis)                                      |
| `UpstashRedisPublisher`  | ✅             | Adapter for [Upstash Redis](https://github.com/upstash/redis-js)                             |
| `PublisherDurableObject` | ✅             | Adapter for [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) |

::: info
If you'd like to add a new publisher adapter, please open an issue.
:::

### Memory Publisher

```ts
import { MemoryPublisher } from '@orpc/experimental-publisher/memory'

const publisher = new MemoryPublisher<{
  'something-updated': {
    id: string
  }
}>({
  resumeRetentionSeconds: 60 * 2, // Retain events for 2 minutes to support resume
})
```

::: info
Resume support is disabled by default in `MemoryPublisher`. Enable it by setting `resumeRetentionSeconds` to an appropriate value.
:::

### IORedis Publisher

```ts
import { Redis } from 'ioredis'
import { IORedisPublisher } from '@orpc/experimental-publisher/ioredis'

const publisher = new IORedisPublisher<{
  'something-updated': {
    id: string
  }
}>({
  commander: new Redis(), // For executing short-lived commands
  subscriber: new Redis(), // For subscribing to events
  resumeRetentionSeconds: 60 * 2, // Retain events for 2 minutes to support resume
  prefix: 'orpc:publisher:', // avoid conflict with other keys
  customJsonSerializers: [] // optional custom serializers
})
```

This adapter requires two Redis instances: one for executing short-lived commands and another for subscribing to events.

::: info
Resume support is disabled by default in `IORedisPublisher`. Enable it by setting `resumeRetentionSeconds` to an appropriate value.
:::

### Upstash Redis Publisher

```ts
import { Redis } from '@upstash/redis'
import { UpstashRedisPublisher } from '@orpc/experimental-publisher/upstash-redis'

const redis = Redis.fromEnv()

const publisher = new UpstashRedisPublisher<{
  'something-updated': {
    id: string
  }
}>(redis, {
  resumeRetentionSeconds: 60 * 2, // Retain events for 2 minutes to support resume
  prefix: 'orpc:publisher:', // avoid conflict with other keys
  customJsonSerializers: [] // optional custom serializers
})
```

::: info
Resume support is disabled by default in `UpstashRedisPublisher`. Enable it by setting `resumeRetentionSeconds` to an appropriate value.
:::

### Cloudflare Durable Object

```ts
import { DurablePublisher, PublisherDurableObject } from '@orpc/experimental-publisher-durable-object'

export class PublisherDO extends PublisherDurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      resume: {
        retentionSeconds: 60 * 2, // Retain events for 2 minutes to support resume
        cleanupIntervalSeconds: 12 * 60 * 60, // Interval for inactivity checks; if inactive, the DO is cleaned up (default: 12 hours)
      },
    })
  }
}

export default {
  async fetch(request, env) {
    const publisher = new DurablePublisher<{
      'something-updated': {
        id: string
      }
    }>(env.PUBLISHER_DO, {
      prefix: 'publisher1', // avoid conflict with other keys
      customJsonSerializers: [] // optional custom serializers
    })
  },
}
```

::: warning
You must enable the [`enable_request_signal`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests) compatibility flag in your workers to support request abort signals, which are necessary for properly cleaning up subscriptions.

```json
{
  "compatibility_flags": [
    "enable_request_signal"
  ]
}
```

:::

::: info
Resume support is disabled by default in `PublisherDurableObject`. Enable it by setting `resume.retentionSeconds` to an appropriate value.
:::
