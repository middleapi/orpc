# tRPC Integration

This guide explains how to integrate oRPC with [tRPC](https://trpc.io/), allowing you to leverage oRPC features in your existing tRPC applications.

## Installation

::: code-group

```sh [npm]
npm install @orpc/trpc@beta
```

```sh [yarn]
yarn add @orpc/trpc@beta
```

```sh [pnpm]
pnpm add @orpc/trpc@beta
```

```sh [bun]
bun add @orpc/trpc@beta
```

```sh [deno]
deno add npm:@orpc/trpc@beta
```

:::

## Router Conversion

`toORPCRouter` converts a [tRPC router](https://trpc.io/docs/server/routers) into an [oRPC router](/docs/router):

```ts
import { toORPCRouter } from '@orpc/trpc'

const orpcRouter = toORPCRouter(trpcRouter)
```

The result is a regular oRPC router, so you can use it with any oRPC feature. For example, expose it through an [RPC Handler](/docs/rpc/handler) or [OpenAPI Handler](/docs/openapi/handler), call it directly with [Server-Side Clients](/docs/client/server-side), generate an [OpenAPI Specification](/docs/openapi/specification), and combine it with oRPC [middlewares](/docs/middleware), [plugins](/docs/openapi/handler#plugins), and [interceptors](/docs/openapi/handler#interceptors).

```ts
import { call, createRouterClient } from '@orpc/server'

// call a procedure directly
const output = await call(orpcRouter.ping, { input: 123 }, { context: {} })

// or create a server-side client
const client = createRouterClient(orpcRouter, { context: {} })
const result = await client.nested.pong({ id: '123' })
```

::: info
Input/output validation stays in tRPC's hands: converted procedures delegate execution to the original tRPC procedures, so your tRPC middlewares, validation, and transforms run exactly as before.
:::

## OpenAPI

Once converted, your tRPC app gets first-class OpenAPI support. Define OpenAPI metadata under the `'~openapi'` key in your tRPC meta by bridging [oRPC meta plugins](/docs/metadata) with `toTRPCMeta`:

```ts
import type { Meta } from '@orpc/server'
import { openapi } from '@orpc/openapi'
import { toTRPCMeta } from '@orpc/trpc'

export const t = initTRPC.context<Context>().meta<Meta>().create()

const example = t.procedure
  .meta(toTRPCMeta(openapi({ path: '/hello', summary: 'Hello procedure' }))) // [!code highlight]
  .input(z.object({ name: z.string() }))
  .query(({ input }) => {
    return `Hello, ${input.name}!`
  })
```

::: warning
Unlike oRPC builders, chained tRPC `.meta()` calls merge shallowly, so plugin merge logic (e.g. accumulating `tags`) only applies to plugins resolved within a single `toTRPCMeta` call.
:::

Learn more in [OpenAPI Specification](/docs/openapi/specification) and [OpenAPI Handler](/docs/openapi/handler).

## Error Formatting

The `toORPCRouter` does not support [tRPC Error Formatting](https://trpc.io/docs/server/error-formatting). You should catch errors and format them manually using [interceptors](/docs/openapi/handler#interceptors):

```ts
const handler = new OpenAPIHandler(orpcRouter, {
  interceptors: [
    async ({ next }) => {
      try {
        return await next()
      }
      catch (error) {
        if (
          error instanceof ORPCError
          && error.cause instanceof TRPCError
          && error.cause.cause instanceof z.ZodError
        ) {
          throw new ORPCError('UNPROCESSABLE_CONTENT', {
            message: z.prettifyError(error.cause.cause),
            data: z.flattenError(error.cause.cause),
            cause: error.cause.cause,
          })
        }

        throw error
      }
    },
  ],
})
```
