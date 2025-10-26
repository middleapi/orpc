---
title: OpenTelemetry Integration
description: Seamlessly integrate oRPC with OpenTelemetry for distributed tracing
---

# OpenTelemetry Integration

[OpenTelemetry](https://opentelemetry.io/) provides observability APIs and instrumentation for applications. oRPC integrates seamlessly with OpenTelemetry to instrument your APIs for distributed tracing.

::: warning
This guide assumes familiarity with [OpenTelemetry](https://opentelemetry.io/). Review the official documentation if needed.
:::

![oRPC OpenTelemetry Integration Preview](/images/opentelemetry-integration-preview.png)

::: info
See the complete example in our [Bun WebSocket + OpenTelemetry Playground](/docs/playgrounds).
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/otel@latest
```

```sh [yarn]
yarn add @orpc/otel@latest
```

```sh [pnpm]
pnpm add @orpc/otel@latest
```

```sh [bun]
bun add @orpc/otel@latest
```

```sh [deno]
deno add npm:@orpc/otel@latest
```

:::

## Setup

To set up OpenTelemetry with oRPC, use the `ORPCInstrumentation` class. This class automatically instruments your oRPC client and server for distributed tracing.

::: code-group

```ts twoslash [server]
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ORPCInstrumentation } from '@orpc/otel'

const sdk = new NodeSDK({
  instrumentations: [
    new ORPCInstrumentation(), // [!code highlight]
  ],
})

sdk.start()
```

```ts twoslash [client]
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { ORPCInstrumentation } from '@orpc/otel'

const provider = new WebTracerProvider()

provider.register()

registerInstrumentations({
  instrumentations: [
    new ORPCInstrumentation(), // [!code highlight]
  ],
})
```

:::

::: info
While OpenTelemetry can be used on both server and client sides, using it on the server only is sufficient in most cases.
:::

## Middleware Span

oRPC automatically creates spans for each [middleware](/docs/middleware) execution. You can access the active span to customize attributes, events, and other span data:

```ts
import { trace } from '@opentelemetry/api'

export const someMiddleware = os.middleware(async (ctx, next) => {
  const span = trace.getActiveSpan()

  span?.setAttribute('someAttribute', 'someValue')
  span?.addEvent('someEvent')

  return next()
})

Object.defineProperty(someMiddleware, 'name', {
  value: 'someName',
})
```

::: tip
Define the `name` property on your middleware to improve span naming and make traces easier to read.
:::

## Handling Uncaught Exceptions

oRPC may throw errors before they reach the error handling layer, such as invalid WebSocket messages or adapter interceptor errors. We recommend capturing these errors:

```ts
import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('uncaught-errors')

function recordError(eventName: string, reason: unknown) {
  const span = tracer.startSpan(eventName)
  const message = String(reason)

  if (reason instanceof Error) {
    span.recordException(reason)
  }
  else {
    span.recordException({ message })
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message })
  span.end()
}

process.on('uncaughtException', (reason) => {
  recordError('uncaughtException', reason)
  // process.exit(1) // uncomment to restore default Node.js behavior
})

process.on('unhandledRejection', (reason) => {
  recordError('unhandledRejection', reason)
  // process.exit(1) // uncomment to restore default Node.js behavior
})
```

## Capture Abort Signals

If your application heavily uses [Event Iterator](/docs/event-iterator) or similar streaming patterns, we recommend capturing an event when the `signal` is aborted to properly track and detach unexpected long-running operations:

```ts
import { trace } from '@opentelemetry/api'

const handler = new RPCHandler(router, {
  interceptors: [
    ({ request, next }) => {
      const span = trace.getActiveSpan()

      request.signal?.addEventListener('abort', () => {
        span?.addEvent('aborted', { reason: String(request.signal?.reason) })
      })

      return next()
    },
  ],
})
```

## Context Propagation

When using oRPC with HTTP/fetch adapters, you should set up proper HTTP instrumentation for [context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) on both client and server. This ensures trace context propagates between services, maintaining distributed tracing integrity.

::: info
Common libraries for HTTP instrumentation include [@hono/otel](https://www.npmjs.com/package/@hono/otel), [@opentelemetry/instrumentation-http](https://www.npmjs.com/package/@opentelemetry/instrumentation-http), [@opentelemetry/instrumentation-fetch](https://www.npmjs.com/package/@opentelemetry/instrumentation-fetch), etc.
:::
