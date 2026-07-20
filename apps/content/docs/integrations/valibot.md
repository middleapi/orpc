# Valibot Integration

[Valibot](https://valibot.dev/) implements [Standard Schema](/docs/integrations/standard-schema), so you can use it directly in your procedures without any extra setup. On top of that, `@orpc/valibot` provides a dedicated JSON Schema converter.

## Installation

::: code-group

```sh [npm]
npm install @orpc/valibot@beta valibot
```

```sh [yarn]
yarn add @orpc/valibot@beta valibot
```

```sh [pnpm]
pnpm add @orpc/valibot@beta valibot
```

```sh [bun]
bun add @orpc/valibot@beta valibot
```

```sh [deno]
deno add npm:@orpc/valibot@beta npm:valibot
```

:::

## JSON Schema Converter

`ValibotToJsonSchemaConverter` wraps [Valibot's built-in toJsonSchema](https://github.com/open-circle/valibot/blob/main/packages/to-json-schema/README.md) and adds support for additional types such as `v.bigint()`, `v.date()`, `v.set()`, and `v.map()`. Use it with tools such as the [OpenAPI Generator](/docs/openapi/specification#openapi-generator) and [Smart Coercion](/docs/plugins/smart-coercion). It accepts the same options as Valibot's `toJsonSchema`, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/valibot/src/converter.ts) for implementation details.

```ts
import { OpenAPIGenerator } from '@orpc/openapi'
import { ValibotToJsonSchemaConverter } from '@orpc/valibot'

const generator = new OpenAPIGenerator({
  converters: [new ValibotToJsonSchemaConverter()],
})
```

### Reusable Schemas

A common pattern is defining reusable or recursive schemas via definitions. The converter preserves them in `$defs`, which `OpenAPIGenerator` can then [hoist](/docs/openapi/specification#hoisting-defs) into `components.schemas`. For more on how definitions work in Valibot, see [Valibot JSON Schema Definitions](https://github.com/open-circle/valibot/blob/main/packages/to-json-schema/README.md#definitions).

```ts
import * as v from 'valibot'

const PlanetSchema = v.object({
  id: v.string(),
  name: v.string(),
})

const generator = new OpenAPIGenerator({
  converters: [
    new ValibotToJsonSchemaConverter({
      definitions: { PlanetSchema },
    }),
  ],
})
```
