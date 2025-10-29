---
title: Electron Adapter
description: Use oRPC inside an Electron project
---

# Electron Adapter

Establish type-safe communication between processes in [Electron](https://www.electronjs.org/) using the [Message Port Adapter](/docs/adapters/message-port). Before you start, we recommend reading the [MessagePorts in Electron](https://www.electronjs.org/docs/latest/tutorial/message-ports) guide.

## Main Process

Listen for a port sent from the renderer, then upgrade it:

```ts
import { RPCHandler } from '@orpc/server/message-port'
import { onError } from '@orpc/server'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

app.whenReady().then(() => {
  ipcMain.on('start-orpc-server', async (event) => {
    const [serverPort] = event.ports
    handler.upgrade(serverPort)
    serverPort.start()
  })
})
```

:::info
Channel `start-orpc-server` is arbitrary. you can use any name that fits your needs.
:::

## Preload Process

Receive the port from the renderer and forward it to the main process:

```ts
window.addEventListener('message', (event) => {
  if (event.data === 'start-orpc-client') {
    const [serverPort] = event.ports

    ipcRenderer.postMessage('start-orpc-server', null, [serverPort])
  }
})
```

## Renderer Process

Create a `MessageChannel`, send one port to the preload script, and use the other to initialize the client link:

```ts
const { port1: clientPort, port2: serverPort } = new MessageChannel()

window.postMessage('start-orpc-client', '*', [serverPort])

const link = new RPCLink({
  port: clientPort,
})

clientPort.start()
```

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::
