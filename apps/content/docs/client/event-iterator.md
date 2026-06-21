# Event Iterator in Client

Consume an [Event Iterator](/docs/event-iterator) like an [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator). Await the call, then iterate over events as they arrive.

## Basic Usage

```ts twoslash
import { ContractRouterClient, eventIterator, oc } from '@orpc/contract'
import { z } from 'zod'

const contract = {
  streaming: oc.output(eventIterator(z.object({ message: z.string() })))
}

declare const client: ContractRouterClient<typeof contract>
// ---cut---
const iterator = await client.streaming()

for await (const event of iterator) {
  console.log(event.message)
}
```

## Stopping the Stream

Use an `AbortSignal` or call `.return` to stop the iterator.

```ts
const controller = new AbortController()
const iterator = await client.streaming(undefined, { signal: controller.signal })

// Stop the stream after 1 second
setTimeout(async () => {
  controller.abort()

  // Or call `await iterator.return()` if you already have the iterator instance.
}, 1000)

for await (const event of iterator) {
  console.log(event.message)
}
```

## Error Handling

::: info
Unlike traditional SSE, Event Iterators do not retry automatically after an error. To add retries, use the [Retry Plugin](/docs/plugins/retry#event-source-simulation).
:::

```ts
const iterator = await client.streaming()

try {
  for await (const event of iterator) {
    console.log(event.message)
  }
}
catch (error) {
  if (error instanceof ORPCError) {
    // Handle the error here
  }
}
```

## Event Metadata

Use `getEventMeta` to read [event metadata](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format) for each item, such as the event ID and retry interval.

```ts
import { getEventMeta } from '@orpc/client'

const iterator = await client.streaming()

for await (const event of iterator) {
  const meta = getEventMeta(event)
  console.log(event.message, meta?.id, meta?.retry)
}
```

## Using `consumeEventIterator`

Use `consumeEventIterator` to consume an event iterator with lifecycle callbacks. It accepts either an event iterator or a promise that resolves to one.

```ts
import { consumeEventIterator } from '@orpc/client'

const cancel = consumeEventIterator(client.streaming(), {
  onEvent: (event) => {
    console.log(event.message)
  },
  onError: (error) => {
    console.error(error)
  },
  onSuccess: (value) => {
    console.log(value)
  },
  onFinish: (state) => {
    console.log(state)
  },
})

setTimeout(async () => {
  // Stop the stream after 1 second
  await cancel()
}, 1000)
```
