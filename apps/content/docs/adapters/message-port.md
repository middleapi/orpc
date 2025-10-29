---
title: Message Port
description: Using oRPC with Message Ports
---

# Message Port

oRPC offers built-in support for common Message Port implementations, enabling easy internal communication between different processes.

| Environment                                                                                | Documentation                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [Electron Message Port](https://www.electronjs.org/docs/latest/tutorial/message-ports)     | [Adapter Guide](/docs/adapters/electron)       |
| Browser (extension background to popup/content, window to window, etc.)                    | [Adapter Guide](/docs/adapters/browser)        |
| [Node.js Worker Threads Port](https://nodejs.org/api/worker_threads.html#workerparentport) | [Adapter Guide](/docs/adapters/worker-threads) |

## Basic Usage

Message Ports work by establishing two endpoints that can communicate with each other:

```ts [bridge]
const channel = new MessageChannel()
const serverPort = channel.port1
const clientPort = channel.port2
```

```ts [server]
import { RPCHandler } from '@orpc/server/message-port'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

handler.upgrade(serverPort, {
  context: {}, // Provide initial context if needed
})

serverPort.start()
```

```ts [client]
import { RPCLink } from '@orpc/client/message-port'

const link = new RPCLink({
  port: clientPort,
})

clientPort.start()
```

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::

## Transfer

By default, oRPC serializes request/response messages to string/binary data before sending over message port. If needed, you can define the `transfer` option to utilize full power of [MessagePort: postMessage() method](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage), such as transferring ownership of objects to the other side or support unserializable objects like `OffscreenCanvas`.

::: code-group

```ts [handler]
const handler = new RPCHandler(router, {
  experimental_transfer: (message, port) => {
    const transfer = deepFindTransferableObjects(message) // implement your own logic
    return transfer.length ? transfer : null // only enable when needed
  }
})
```

```ts [link]
const link = new RPCLink({
  port: clientPort,
  experimental_transfer: (message) => {
    const transfer = deepFindTransferableObjects(message) // implement your own logic
    return transfer.length ? transfer : null // only enable when needed
  }
})
```

:::

::: warning
When `transfer` returns an array, messages using [the structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) for sending, which doesn't support all data types such as [Event Iterator's Metadata](/docs/event-iterator#last-event-id-event-metadata). So I recommend you only enable this when needed.
:::

::: tip
The `transfer` option run after [RPC JSON Serializer](/docs/advanced/rpc-json-serializer) so you can combine them together to support more data types.
:::
