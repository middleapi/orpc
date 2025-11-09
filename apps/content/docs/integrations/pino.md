---
title: Pino Integration
description: Integrate oRPC with Pino for structured logging and request tracking.
---

# Pino Integration

[Pino](https://getpino.io/) is a fast and lightweight JSON logger. This guide explains how to integrate oRPC with Pino to add structured logging, request tracking, and error monitoring to your applications.

::: warning
This guide assumes familiarity with [Pino](https://getpino.io/). Review the official documentation if needed.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-pino@latest pino@latest
```

```sh [yarn]
yarn add @orpc/experimental-pino@latest pino@latest
```

```sh [pnpm]
pnpm add @orpc/experimental-pino@latest pino@latest
```

```sh [bun]
bun add @orpc/experimental-pino@latest pino@latest
```

```sh [deno]
deno add npm:@orpc/experimental-pino@latest npm:pino@latest
```

:::

## Setup

To set up Pino with oRPC, use the `LoggingHandlerPlugin` class. This plugin automatically instruments your handler with structured logging, request tracking, and error monitoring.

```ts
import { LoggingHandlerPlugin } from '@orpc/experimental-pino'
import pino from 'pino'

const logger = pino()

const handler = new RPCHandler(router, {
  plugins: [
    new LoggingHandlerPlugin({
      logger, // Custom logger instance
      generateId: ({ request }) => crypto.randomUUID(), // Custom ID generator
      logRequestResponse: true, // Log request start/end (disabled by default)
      logRequestAbort: true, // Log when requests are aborted (disabled by default)
    }),
  ],
})
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or another custom handler.
:::

::: tip
For improved log readability during development, consider using [pino-pretty](https://github.com/pinojs/pino-pretty) to format your logs in a human-friendly way.

```bash
npm run dev | npx pino-pretty
```

:::

## Using the Logger in Your Code

You can access the logger from the context object using the `getLogger` function:

```ts
import { getLogger } from '@orpc/experimental-pino'

const procedure = os.handler(({ context }) => {
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
  CONTEXT_LOGGER_SYMBOL,
  LoggerContext,
  LoggingHandlerPlugin
} from '@orpc/experimental-pino'

const logger = pino()
const httpLogger = pinoHttp({ logger })

interface ORPCContext extends LoggerContext {} // [!code highlight]

const router = {
  ping: os.$context<ORPCContext>().handler(() => 'pong')
}

const handler = new RPCHandler(router, {
  plugins: [
    new LoggingHandlerPlugin({ logger }), // [!code highlight]
  ],
})

const server = createServer(async (req, res) => {
  httpLogger(req, res)

  const { matched } = await handler.handle(req, res, {
    prefix: '/api',
    context: {
      [CONTEXT_LOGGER_SYMBOL]: req.log, // [!code highlight]
    },
  })

  if (!matched) {
    res.statusCode = 404
    res.end('Not Found')
  }
})
```
