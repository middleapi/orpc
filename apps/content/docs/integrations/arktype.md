# ArkType Integration

[ArkType](https://arktype.io/) implements [Standard Schema](/docs/integrations/standard-schema), so you can use it directly in your procedures without any extra setup. On top of that, `@orpc/arktype` provides a dedicated JSON Schema converter.

## Installation

::: code-group

```sh [npm]
npm install @orpc/arktype@beta arktype
```

```sh [yarn]
yarn add @orpc/arktype@beta arktype
```

```sh [pnpm]
pnpm add @orpc/arktype@beta arktype
```

```sh [bun]
bun add @orpc/arktype@beta arktype
```

```sh [deno]
deno add npm:@orpc/arktype@beta npm:arktype
```

:::

## JSON Schema Converter

`ArkTypeToJsonSchemaConverter` wraps [ArkType's built-in toJsonSchema](https://arktype.io/docs/type-api#tojsonschema) and adds support for additional types such as `bigint` and `Date`. Use it with tools such as the [OpenAPI Generator](/docs/openapi/specification#openapi-generator) and [Smart Coercion](/docs/plugins/smart-coercion). It accepts the same options as ArkType's `toJsonSchema`, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/arktype/src/converter.ts) and ArkType's [JSON Schema configuration docs](https://arktype.io/docs/configuration#tojsonschema) for implementation details.

```ts
import { OpenAPIGenerator } from '@orpc/openapi'
import { ArkTypeToJsonSchemaConverter } from '@orpc/arktype'

const generator = new OpenAPIGenerator({
  converters: [new ArkTypeToJsonSchemaConverter()],
})
```

### Reusable Types

A common pattern is defining reusable or recursive types using scopes. The converter preserves them in `$defs`, which `OpenAPIGenerator` can then [hoist](/docs/openapi/specification#hoisting-defs) into `components.schemas`.

```ts
import { scope } from 'arktype'

const types = scope({
  Planet: {
    name: 'string',
    neighbors: 'Planet[]',
  },
})

const PlanetSchema = types.export().Planet
```
