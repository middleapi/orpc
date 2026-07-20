# Zod Integration

[Zod](https://zod.dev/) implements [Standard Schema](/docs/integrations/standard-schema), so you can use it directly in your procedures without any extra setup. On top of that, `@orpc/zod` provides a dedicated JSON Schema converter and registries for customizing the generated JSON schemas.

::: warning
`@orpc/zod` requires Zod v4 or later.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/zod@beta zod
```

```sh [yarn]
yarn add @orpc/zod@beta zod
```

```sh [pnpm]
pnpm add @orpc/zod@beta zod
```

```sh [bun]
bun add @orpc/zod@beta zod
```

```sh [deno]
deno add npm:@orpc/zod@beta npm:zod
```

:::

## JSON Schema Converter

`ZodToJsonSchemaConverter` wraps [Zod's built-in toJSONSchema](https://zod.dev/json-schema?id=ztojsonschema#ztojsonschema) and adds support for additional types such as `z.bigint()`, `z.date()`, `z.set()`, and `z.map()`. Use it with tools such as the [OpenAPI Generator](/docs/openapi/specification#openapi-generator) and [Smart Coercion](/docs/plugins/smart-coercion). It accepts the same options as Zod's `toJSONSchema`, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/zod/src/converter.ts) for implementation details.

```ts
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

const generator = new OpenAPIGenerator({
  converters: [new ZodToJsonSchemaConverter()],
})
```

### Reusable Schemas

A common pattern is defining reusable schemas with `id` metadata. The converter places them in `$defs`, which `OpenAPIGenerator` then [hoists](/docs/openapi/specification#hoisting-defs) into `components.schemas`. For more on `id` and `$ref` in Zod, see [Zod JSON Schema Registries](https://zod.dev/json-schema?id=registries#registries).

```ts
import * as z from 'zod'

const PlanetSchema = z.object({
  id: z.string(),
  name: z.string(),
}).meta({ id: 'Planet' })
```

### Customizing Generated JSON Schemas

`@orpc/zod` exposes registries for customizing the JSON schema generated for a given Zod schema. Registered entries are shallow merged over the generated JSON schema: `JSON_SCHEMA_REGISTRY` applies to both input and output, while `JSON_SCHEMA_INPUT_REGISTRY` and `JSON_SCHEMA_OUTPUT_REGISTRY` apply to a single direction and win on conflicting keys:

```ts
import {
  JSON_SCHEMA_INPUT_REGISTRY,
  JSON_SCHEMA_OUTPUT_REGISTRY,
  JSON_SCHEMA_REGISTRY,
} from '@orpc/zod'
import * as z from 'zod'

const user = z.object({
  name: z.string(),
  age: z.string().transform(v => Number(v)),
})

JSON_SCHEMA_REGISTRY.add(user, {
  description: 'A user',
})

JSON_SCHEMA_INPUT_REGISTRY.add(user, {
  examples: [{ name: 'John', age: '20' }],
})

JSON_SCHEMA_OUTPUT_REGISTRY.add(user, {
  examples: [{ name: 'John', age: 20 }],
})
```
