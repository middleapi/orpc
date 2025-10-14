---
title: Browser Adapter
description: Type-safe communication between browser scripts using Message Port Adapter
---

# Browser Adapter

Enable type-safe communication between browser scripts using the [Message Port Adapter](/docs/adapters/message-port).

## Between Extension Scripts

To set up communication between scripts in a browser extension (e.g. background, content, popup), configure one script to listen for connections and upgrade them, and another to initiate the connection.

::: warning
The browser extension [Message Passing API](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) does not support transferring binary data, which means oRPC features like `File` and `Blob` cannot be used natively. However, you can temporarily work around this limitation by extending the [RPC JSON Serializer](/docs/advanced/rpc-json-serializer#extending-native-data-types) to encode binary data as Base64.
:::

::: code-group

```ts [server]
import { RPCHandler } from '@orpc/server/message-port'

const handler = new RPCHandler(router)

browser.runtime.onConnect.addListener((port) => {
  handler.upgrade(port, {
    context: {}, // provide initial context if needed
  })
})
```

```ts [client]
import { RPCLink } from '@orpc/client/message-port'

const port = browser.runtime.connect()

const link = new RPCLink({
  port,
})
```

:::

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::

## Window to Window

To enable communication between two window contexts (e.g. parent and popup), one must listen and upgrade the port, and the other must initiate the connection.

::: code-group

```ts [opener]
import { RPCHandler } from '@orpc/server/message-port'

const handler = new RPCHandler(router)

window.addEventListener('message', (event) => {
  if (event.data instanceof MessagePort) {
    handler.upgrade(event.data, {
      context: {}, // Optional context
    })

    event.data.start()
  }
})

window.open('/example/popup', 'popup', 'width=680,height=520')
```

```ts [popup]
import { RPCLink } from '@orpc/client/message-port'

const { port1: serverPort, port2: clientPort } = new MessageChannel()

window.opener.postMessage(serverPort, '*', [serverPort])

const link = new RPCLink({
  port: clientPort,
})

clientPort.start()
```

:::

## Advanced Relay Pattern

In some advanced cases, direct communication between scripts isn't possible. For example, a content script running in the ["MAIN" world](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#world-timings) cannot directly communicate with the background script using `browser.runtime` or `chrome.runtime` APIs.

To work around this, you can use a **relay pattern** typically an additional content script running in the default **"ISOLATED" (default) world** to relay messages between the two contexts. This **relay pattern** acts as an intermediary, enabling communication where direct access is restricted.

::: code-group

```ts [relay]
window.addEventListener('message', (event) => {
  if (event.data instanceof MessagePort) {
    const port = browser.runtime.connect()

    // Relay `message` and `close/disconnect` events between the MessagePort and runtime.Port

    event.data.addEventListener('message', (event) => {
      port.postMessage(event.data)
    })

    event.data.addEventListener('close', () => {
      port.disconnect()
    })

    port.onMessage.addListener((message) => {
      event.data.postMessage(message)
    })

    port.onDisconnect.addListener(() => {
      event.data.close()
    })

    event.data.start()
  }
})
```

```ts [server]
import { RPCHandler } from '@orpc/server/message-port'

const handler = new RPCHandler(router)

browser.runtime.onConnect.addListener((port) => {
  handler.upgrade(port, {
    context: {}, // provide initial context if needed
  })
})
```

```ts [client]
import { RPCLink } from '@orpc/client/message-port'

const { port1: serverPort, port2: clientPort } = new MessageChannel()

window.postMessage(serverPort, '*', [serverPort])

const link = new RPCLink({
  port: clientPort,
})

clientPort.start()
```

:::
