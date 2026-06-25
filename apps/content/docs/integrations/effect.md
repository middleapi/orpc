# Effect Integration

[Effect](https://effect.website/) integration lets you seamlessly use Effect's powerful features, such as its effect system, concurrency model, and schema library, within oRPC.

::: warning
This guide assumes familiarity with [Effect](https://effect.website/). Review the official documentation if needed.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-effect@beta effect@beta
```

```sh [yarn]
yarn add @orpc/experimental-effect@beta effect@beta
```

```sh [pnpm]
pnpm add @orpc/experimental-effect@beta effect@beta
```

```sh [bun]
bun add @orpc/experimental-effect@beta effect@beta
```

```sh [deno]
deno add npm:@orpc/experimental-effect@beta npm:effect@beta
```

:::

## Effectful Handlers

`handlerGen` allows you to write effectful handlers using generator functions. Inside the generator, you can yield Effect operations, and `handlerGen` will handle the execution and error handling for you.

```ts twoslash
import { os } from '@orpc/server'
// ---cut---
import { handlerGen } from '@orpc/experimental-effect'
import { Effect } from 'effect'

const procedure = os.handler(handlerGen(function* ({ input, context }) {
  // You can use Effect's features here, such as concurrency, error handling, etc.
  const result = yield* Effect.promise(() => Promise.resolve(5))
  return result
}))
```

### `.effect` extension

Import `@orpc/experimental-effect/extensions/effect` from a module that always runs during initialization, such as the file where you define your base builder or create your server. This adds an `.effect` method to the builder so you can write effectful handlers directly.

::: code-group

```ts [usage]
const procedure = base.effect(function* ({ input, context }) {
  // You can use Effect's features here, such as concurrency, error handling, etc.
  const result = yield* Effect.promise(() => Promise.resolve(5))
  return result
})
```

```ts [setup]
import '@orpc/experimental-effect/extensions/effect'

import { os } from '@orpc/server'

export const base = os
```

:::

### Effect Services

You can provide Effect services through the oRPC context in a typesafe way with `WithEffectContext` and `~effect/context`:

```ts twoslash
import { call, os } from '@orpc/server'
// ---cut---
import { handlerGen, WithEffectContext } from '@orpc/experimental-effect'
import { Context, Effect } from 'effect'

class Random extends Context.Service<
  Random,
  {
    readonly next: Effect.Effect<number>
  }
>()('MyRandomService') {}

interface ServerContext extends WithEffectContext<Random> {}

const procedure = os
  .$context<ServerContext>()
  .handler(handlerGen(function* ({ input, context }) {
    const random = yield* Random
    const result = yield* random.next
    return result
  }))

const random = await call(procedure, undefined, {
  context: {
    '~effect/context': Context.empty().pipe(
      Context.add(Random, {
        next: Effect.succeed(Math.random()),
      }),
    )
  }
})
```

::: info
You can also extend the Effect context with [middleware](/docs/middleware):

```ts
const procedure = os
  .$context<ServerContext>()
  .use(({ context, next }) => {
    return next({
      context: {
        '~effect/context': context['~effect/context'].pipe(
          Context.add(AdditionService, {}),
        )
      }
    })
  })
  .handler(handlerGen(function* ({ input, context }) {
    const additionService = yield* AdditionService
  }))
```

:::

### Error Handling

This integration preserves the original error whenever possible. If you call `Effect.fail(error)`, the error is forwarded to [middleware](/docs/middleware) and interceptors, just like a regular thrown error.

To customize this behavior, wrap the effect before execution using `~effect/wrap` in the context:

```ts
import { Context, Effect } from 'effect'

interface ServerContext extends WithEffectContext<never> {}

export async function fetch(request: Request) {
  const { response } = await handler.fetch(request, {
    context: {
      '~effect/context': Context.empty(),
      '~effect/wrap': (effect, opts) => effect.pipe(
        Effect.catchCause((cause) => {

        })
      ),
    }
  })

  return response ?? new Response('Not Found', { status: 404 })
}
```

::: info
For app level error handling, we recommend [middleware](/docs/middleware) or interceptors.
:::

### Typesafe Errors

When you `yield* Effect.fail(new ORPCError(...))` or `return new ORPCError(...)`, oRPC treats it as a [returned ORPCError](/docs/error-handling#returning-an-orpcerror). On the client, you can handle these errors in a typesafe way:

```ts
const procedure = os.handler(handlerGen(function* ({ errors }) {
  if (resourceNotFound) {
    yield* Effect.fail(new ORPCError('NOT_FOUND', {
      message: 'The resource you are looking for does not exist',
    }))
    // -- or -
    return new ORPCError('NOT_FOUND', {
      message: 'The resource you are looking for does not exist',
    })
  }

  return 'Success'
}))

const [error, result] = await call(procedure)

if (isInferableError(error)) {
  // typesafe error handling
}
```

## Effect Schema

oRPC natively supports [Standard Schema](https://standardschema.dev/schema#what-schema-libraries-implement-the-spec), and [Effect Schema](https://effect.website/docs/schema/introduction/) implements that spec through [Schema.toStandardSchemaV1](https://effect.website/docs/schema/standard-schema/):

```ts
import { Schema } from 'effect'

const procedure = os
  .input(Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String })))
  .handler(handlerGen(function* ({ input, context }) {
    return `Hello ${input.name}!`
  }))
```

### `.input` and `.output` Extensions

Import `@orpc/experimental-effect/extensions/input-output` from a module that always runs during initialization, such as the file where you define your base builder or create your server. This lets you define `.input` and `.output` directly with Effect Schema:

::: code-group

```ts [usage]
const procedure = base
  .input(Schema.Struct({ name: Schema.String }))
  .output(Schema.Struct({ greeting: Schema.String }))
  .handler(handlerGen(function* ({ input, context }) {
    return { greeting: `Hello ${input.name}!` }
  }))
```

```ts [setup]
import '@orpc/experimental-effect/extensions/input-output'

import { os } from '@orpc/server'

export const base = os
```

:::

::: info
You can also use these extensions with the [contract builder](/docs/contract/procedure).
:::

### JSON Schema Converter

This integration also provides `EffectSchemaToJsonSchemaConverter`, built on top of [Effect Schema to JSON Schema](https://effect.website/docs/schema/json-schema/). You can use it with tools such as the [OpenAPI Generator](/docs/openapi/specification#openapi-generator):

```ts
import { EffectSchemaToJsonSchemaConverter } from '@orpc/experimental-effect'

const generator = new OpenAPIGenerator({
  converters: [new EffectSchemaToJsonSchemaConverter()],
})
```

## OpenTelemetry Integration

First, set up the [oRPC OpenTelemetry integration](/docs/integrations/opentelemetry). Then instrument your Effect to work seamlessly with OpenTelemetry by providing `TracingLive` through `~effect/wrap` in the context. This makes Effect tracing equivalent to OpenTelemetry tracing:

```ts
import { Resource, Tracer } from '@effect/opentelemetry'
import { Context, Effect, Layer } from 'effect'

interface ServerContext extends WithEffectContext<never> {}

const TracingLive = Tracer.layerGlobal.pipe(
  Layer.provide(Resource.layerFromEnv()),
)

export async function fetch(request: Request) {
  const { response } = await handler.fetch(request, {
    context: {
      '~effect/context': Context.empty(),
      '~effect/wrap': (effect, opts) => effect.pipe(Effect.provide(TracingLive)),
    }
  })

  return response ?? new Response('Not Found', { status: 404 })
}
```
