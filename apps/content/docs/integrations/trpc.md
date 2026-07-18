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

## OpenAPI Support

By converting a [tRPC router](https://trpc.io/docs/server/routers) to an [oRPC router](/docs/router), you can utilize most oRPC features, including OpenAPI specification generation and request handling.

```ts
import { toORPCRouter } from '@orpc/trpc'

const orpcRouter = toORPCRouter(trpcRouter)
```

::: warning
For OpenAPI features to work, define OpenAPI metadata under the `'~openapi'` key in your tRPC meta, typed with `OpenAPIMeta` from `@orpc/openapi`:

```ts
import type { OpenAPIMeta } from '@orpc/openapi'

interface Meta {
  '~openapi'?: OpenAPIMeta
}

export const t = initTRPC.context<Context>().meta<Meta>().create()

const example = t.procedure
  .meta({ '~openapi': { path: '/hello', summary: 'Hello procedure' } }) // [!code highlight]
  .input(z.object({ name: z.string() }))
  .query(({ input }) => {
    return `Hello, ${input.name}!`
  })
```

If you prefer keeping the metadata under a different key, use the `mapMeta` option to expose it during conversion:

```ts
interface Meta {
  route?: OpenAPIMeta
}

const orpcRouter = toORPCRouter(trpcRouter, {
  mapMeta: meta => ({ ...meta, '~openapi': meta.route }), // [!code highlight]
})
```

:::

### Specification Generation

```ts
const generator = new OpenAPIGenerator({
  converters: [
    new ZodToJsonSchemaConverter(), // <-- if you use Zod
    new ValibotToJsonSchemaConverter(), // <-- if you use Valibot
    new ArkTypeToJsonSchemaConverter(), // <-- if you use ArkType
  ],
})

const spec = await generator.generate(orpcRouter, {
  base: {
    info: {
      title: 'My App',
      version: '0.0.0',
    },
  },
})
```

::: info
Learn more about [oRPC OpenAPI Specification Generation](/docs/openapi/specification).
:::

### Request Handling

```ts
const handler = new OpenAPIHandler(orpcRouter, {
  plugins: [new CORSHandlerPlugin()],
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
Learn more about [oRPC OpenAPI Handler](/docs/openapi/handler).
:::

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
