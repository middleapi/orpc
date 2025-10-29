---
title: Worker Threads Adapter
description: Enable type-safe communication between Node.js Worker Threads using oRPC.
---

# Worker Threads Adapter

Use [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html) with oRPC for type-safe inter-thread communication via the [Message Port Adapter](/docs/adapters/message-port). Before proceeding, we recommend reviewing the [Node.js Worker Thread API](https://nodejs.org/api/worker_threads.html).

## Worker Thread

Listen for a `MessagePort` sent from the main thread and upgrade it:

```ts
import { parentPort } from 'node:worker_threads'
import { RPCHandler } from '@orpc/server/message-port'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

parentPort.on('message', (message) => {
  if (message instanceof MessagePort) {
    handler.upgrade(message, {
      context: {}, // Provide initial context if needed
    })

    message.start()
  }
})
```

## Main Thread

Create a `MessageChannel`, send one port to the thread worker, and use the other to initialize the client link:

```ts
import { MessageChannel, Worker } from 'node:worker_threads'
import { RPCLink } from '@orpc/client/message-port'

const { port1: clientPort, port2: serverPort } = new MessageChannel()

const worker = new Worker('some-worker.js')

worker.postMessage(serverPort, [serverPort])

const link = new RPCLink({
  port: clientPort
})

clientPort.start()
```

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::
