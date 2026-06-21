# Pino Integration

[Pino](https://getpino.io/) integration for oRPC provides structured logging capabilities, allowing you to easily track requests, monitor errors, and gain insights into your application's behavior.

::: warning
This guide assumes familiarity with [Pino](https://getpino.io/). Review the official documentation if needed.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/pino@latest pino@latest
```

```sh [yarn]
yarn add @orpc/pino@latest pino@latest
```

```sh [pnpm]
pnpm add @orpc/pino@latest pino@latest
```

```sh [bun]
bun add @orpc/pino@latest pino@latest
```

```sh [deno]
deno add npm:@orpc/pino@latest npm:pino@latest
```

:::

## Setup

To set up Pino with oRPC, use the `PinoHandlerPlugin` class. This plugin automatically instruments your handler with structured logging, request tracking, and error monitoring.

```ts twoslash
import { RPCHandler } from '@orpc/server/fetch'
import { router } from './shared/planet'
// ---cut---
import { PinoHandlerPlugin } from '@orpc/pino'
import pino from 'pino'

const logger = pino()

const handler = new RPCHandler(router, {
  plugins: [
    new PinoHandlerPlugin({
      logger, // <- custom logger instance
      generateRequestId: ({ request }) => crypto.randomUUID(), // <- custom request id generator
      logLifecycle: true, // <- log information about request lifecycle (disabled by default)
      logAbort: true, // <- log information when requests are aborted (disabled by default)
    }),
  ],
})
```

<!--@include: @/shared/common-plugin-handler-compatibility.md -->

::: tip
For improved log readability during development, consider using [pino-pretty](https://github.com/pinojs/pino-pretty) to format your logs in a human-friendly way.

```bash
npm run dev | npx pino-pretty
```

:::

## Using the Logger in Your Code

You can access the logger from the context object using the `getLogger` function:

```ts
import { getLogger, LoggerContext } from '@orpc/pino'

interface ServerContext extends LoggerContext {} // [!code highlight]

const procedure = os
  .$context<ServerContext>()
  .handler(({ context }) => {
    const logger = getLogger(context) // [!code highlight]

    logger?.info('Processing request')
    logger?.debug({ userId: 123 }, 'User data')

    return { success: true }
  })
```

## Providing Custom Logger per Request

You can provide a custom logger instance for specific requests by passing it through the context. This is especially useful when integrating with [pino-http](https://github.com/pinojs/pino-http) for enhanced HTTP logging:

```ts
import {
  LOGGER_CONTEXT_SYMBOL,
  LoggerContext,
  PinoHandlerPlugin
} from '@orpc/pino'

const logger = pino()
const httpLogger = pinoHttp({ logger })

interface ServerContext extends LoggerContext {} // [!code highlight]

const router = {
  ping: os.$context<ServerContext>().handler(() => 'pong')
}

const handler = new RPCHandler(router, {
  plugins: [
    new PinoHandlerPlugin({ logger }), // [!code highlight]
  ],
})

const server = createServer(async (req, res) => {
  httpLogger(req, res)

  const { matched } = await handler.handle(req, res, {
    prefix: '/api',
    context: {
      [LOGGER_CONTEXT_SYMBOL]: req.log, // [!code highlight]
    },
  })

  if (!matched) {
    res.statusCode = 404
    res.end('Not Found')
  }
})
```
