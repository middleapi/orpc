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

const handler = new RPCHandler(router)

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
