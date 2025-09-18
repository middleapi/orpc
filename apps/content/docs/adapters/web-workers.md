---
title: Web Workers
description: Enable type-safe communication between your web app and its Web Worker.
---

# Web Workers Adapter

Use [Vite Web Workers](https://vite.dev/guide/features.html#web-workers) with oRPC for type-safe communication via the [Message Port Adapter](/docs/adapters/message-port).

:::info
This guide is specific to Vite, but Comlink Web Workers should also work out of the box.
:::

## Web Worker

Listen for a `MessagePort` sent from the web application and upgrade it:

```ts
import { RPCHandler } from '@orpc/server/message-port'

const handler = new RPCHandler(router)

handler.upgrade(self, {
  context: {}
})
```

## Web Application Client

Import the Web Worker implementation and use the exposed Worker interface to initialize the client link.

```ts
import OrpcWorker from './worker?worker'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/message-port'
import type { RouterClient } from '@orpc/server'

const orpcWorker = new OrpcWorker()

export const link = new RPCLink({
  port: orpcWorker
})
```
