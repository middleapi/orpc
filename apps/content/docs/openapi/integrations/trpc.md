---
title: tRPC Integration
description: Use oRPC features in your tRPC applications.
---

# tRPC Integration

This guide explains how to integrate oRPC with tRPC, allowing you to leverage oRPC features in your existing tRPC applications.

## Installation

::: code-group

```sh [npm]
npm install @orpc/trpc@latest
```

```sh [yarn]
yarn add @orpc/trpc@latest
```

```sh [pnpm]
pnpm add @orpc/trpc@latest
```

```sh [bun]
bun add @orpc/trpc@latest
```

```sh [deno]
deno add npm:@orpc/trpc@latest
```

:::

## OpenAPI Support

By converting a [tRPC router](https://trpc.io/docs/server/routers) to an [oRPC router](/docs/router), you can utilize most oRPC features, including OpenAPI specification generation and request handling.

```ts
import { ORPCMeta, toORPCRouter } from '@orpc/trpc'

export const t = initTRPC.context<Context>().meta<ORPCMeta>().create()

const orpcRouter = toORPCRouter(trpcRouter)
```

::: warning
Ensure you set the `.meta` type to `ORPCMeta` when creating your tRPC builder. This is required for OpenAPI features to function properly.

```ts
const example = t.procedure
  .meta({ route: { path: '/hello', summary: 'Hello procedure' } }) // [!code highlight]
  .input(z.object({ name: z.string() }))
  .query(({ input }) => {
    return `Hello, ${input.name}!`
  })
```

:::

### Specification Generation

```ts
const openAPIGenerator = new OpenAPIGenerator({
  schemaConverters: [
    new ZodToJsonSchemaConverter(), // <-- if you use Zod
    new ValibotToJsonSchemaConverter(), // <-- if you use Valibot
    new ArkTypeToJsonSchemaConverter(), // <-- if you use ArkType
  ],
})

const spec = await openAPIGenerator.generate(orpcRouter, {
  info: {
    title: 'My App',
    version: '0.0.0',
  },
})
```

::: info
Learn more about [oRPC OpenAPI Specification Generation](/docs/openapi/openapi-specification).
:::

### Request Handling

```ts
const handler = new OpenAPIHandler(orpcRouter, {
  plugins: [new CORSPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export async function fetch(request: Request) {
  const { matched, response } = await handler.handle(request, {
    prefix: '/api',
    context: {} // Add initial context if needed
  })

  return response ?? new Response('Not Found', { status: 404 })
}
```

::: info
Learn more about [oRPC OpenAPI Handler](/docs/openapi/openapi-handler).
:::

## Error Formatting

The `toORPCRouter` does not support [tRPC Error Formatting](https://trpc.io/docs/server/error-formatting). You should catch errors and format them manually using interceptors:

```ts
const handler = new OpenAPIHandler(orpcRouter, {
  interceptors: [
    onError((error) => {
      if (
        error instanceof ORPCError
        && error.cause instanceof TRPCError
        && error.cause.cause instanceof ZodError
      ) {
        throw new ORPCError('INPUT_VALIDATION_FAILED', {
          status: 422,
          data: error.cause.cause.flatten(),
          cause: error.cause.cause,
        })
      }
    })
  ],
})
```
