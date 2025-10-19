---
title: Event Iterator (SSE)
description: Learn how to streaming responses, real-time updates, and server-sent events using oRPC.
---

# Event Iterator (SSE)

oRPC provides built‑in support for streaming responses, real‑time updates, and server-sent events (SSE) without any extra configuration. This functionality is ideal for applications that require live updates, such as AI chat responses, live sports scores, or stock market data.

## Overview

The event iterator is defined by an asynchronous generator function. In the example below, the handler continuously yields a new event every second:

```ts
const example = os
  .handler(async function* ({ input, lastEventId }) {
    while (true) {
      yield { message: 'Hello, world!' }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })
```

Learn how to consume the event iterator on the client [here](/docs/client/event-iterator)

## Validate Event Iterator

oRPC includes a built‑in `eventIterator` helper that works with any [Standard Schema](https://github.com/standard-schema/standard-schema?tab=readme-ov-file#what-schema-libraries-implement-the-spec) library to validate events.

```ts
import { eventIterator } from '@orpc/server'

const example = os
  .output(eventIterator(z.object({ message: z.string() })))
  .handler(async function* ({ input, lastEventId }) {
    while (true) {
      yield { message: 'Hello, world!' }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })
```

## Last Event ID & Event Metadata

Using the `withEventMeta` helper, you can attach [additional event meta](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format) (such as an event ID or a retry interval) to each event.

::: info
When used with [Client Retry Plugin](/docs/plugins/client-retry) or [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), the client will reconnect with the last event ID. This value is made available to your handler as `lastEventId`, allowing you to resume the stream seamlessly.
:::

```ts
import { withEventMeta } from '@orpc/server'

const example = os
  .handler(async function* ({ input, lastEventId }) {
    if (lastEventId) {
      // Resume streaming from lastEventId
    }
    else {
      while (true) {
        yield withEventMeta({ message: 'Hello, world!' }, { id: 'some-id', retry: 10_000 })
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  })
```

## Stop Event Iterator

To signal the end of the stream, simply use a `return` statement. When the handler returns, oRPC marks the stream as successfully completed.

:::warning
This behavior is exclusive to oRPC. Standard [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) clients, such as those using [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) will automatically reconnect when the connection closes.
:::

```ts
const example = os
  .handler(async function* ({ input, lastEventId }) {
    while (true) {
      if (done) {
        return
      }

      yield { message: 'Hello, world!' }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })
```

## Cleanup Side-Effects

If the client closes the connection or an unexpected error occurs, you can use a `finally` block to clean up any side effects (for example, closing database connections or stopping background tasks):

```ts
const example = os
  .handler(async function* ({ input, lastEventId }) {
    try {
      while (true) {
        yield { message: 'Hello, world!' }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    finally {
      console.log('Cleanup logic here')
    }
  })
```

## Publisher Helper

You can combine the event iterator with the [Publisher Helper](/docs/helpers/publisher) to build real-time features like chat, notifications, or live updates with resume support.

```ts
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

## Event Publisher

Unlike the [Publisher Helper](/docs/helpers/publisher), the `EventPublisher` is more lightweight with synchronous publishing and no resume support.

::: code-group

```ts [Static Events]
import { EventPublisher } from '@orpc/server'

const publisher = new EventPublisher<{
  'something-updated': {
    id: string
  }
}>()

const livePlanet = os
  .handler(async function* ({ input, signal }) {
    for await (const payload of publisher.subscribe('something-updated', { signal })) { // [!code highlight]
      // handle payload here and yield something to client
    }
  })

const update = os
  .input(z.object({ id: z.string() }))
  .handler(({ input }) => {
    publisher.publish('something-updated', { id: input.id }) // [!code highlight]
  })
```

```ts [Dynamic Events]
import { EventPublisher } from '@orpc/server'

const publisher = new EventPublisher<Record<string, { message: string }>>()

const onMessage = os
  .input(z.object({ channel: z.string() }))
  .handler(async function* ({ input, signal }) {
    for await (const payload of publisher.subscribe(input.channel, { signal })) { // [!code highlight]
      yield payload.message
    }
  })

const sendMessage = os
  .input(z.object({ channel: z.string(), message: z.string() }))
  .handler(({ input }) => {
    publisher.publish(input.channel, { message: input.message }) // [!code highlight]
  })
```

:::
