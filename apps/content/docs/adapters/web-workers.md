---
title: Web Workers Adapter
description: Enable type-safe communication with Web Workers using oRPC.
---

# Web Workers Adapter

[Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Worker) allow JavaScript code to run in background threads, separate from the main thread of a web page. This prevents blocking the UI while performing computationally intensive tasks. Web Workers are also supported in modern runtimes like [Bun](https://bun.com/docs/api/workers), [Deno](https://docs.deno.com/examples/web_workers/), etc.

With oRPC, you can establish type-safe communication channels between your main thread and Web Workers. For additional context, see the [Message Port Adapter](/docs/adapters/message-port) guide.

## Web Worker

Configure your Web Worker to handle oRPC requests by upgrading it with a message port handler:

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

handler.upgrade(self, {
  context: {}, // Provide initial context if needed
})
```

## Main Thread

Create a link to communicate with your Web Worker:

```ts
import { RPCLink } from '@orpc/client/message-port'

export const link = new RPCLink({
  port: new Worker('some-worker.ts')
})
```

:::details Using Web Workers in Vite Applications?
You can leverage [Vite Web Workers feature](https://vite.dev/guide/features.html#web-workers) for streamlined development:

```ts
import SomeWorker from './some-worker.ts?worker' // [!code highlight]
import { RPCLink } from '@orpc/client/message-port'

export const link = new RPCLink({
  port: new SomeWorker()
})
```

:::

:::info
This only shows how to configure the link. For full client examples, see [Client-Side Clients](/docs/client/client-side).
:::
