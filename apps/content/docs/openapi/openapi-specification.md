---
title: OpenAPI Specification
description: Generate OpenAPI specifications for oRPC with ease.
---

# OpenAPI Specification

oRPC uses the [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.0) to define APIs. It is fully compatible with [OpenAPILink](/docs/openapi/client/openapi-link) and [OpenAPIHandler](/docs/openapi/openapi-handler).

## Installation

::: code-group

```sh [npm]
npm install @orpc/openapi@latest
```

```sh [yarn]
yarn add @orpc/openapi@latest
```

```sh [pnpm]
pnpm add @orpc/openapi@latest
```

```sh [bun]
bun add @orpc/openapi@latest
```

```sh [deno]
deno install npm:@orpc/openapi@latest
```

:::

## Generating Specifications

oRPC supports OpenAPI 3.1.1 and integrates seamlessly with popular schema libraries like [Zod](https://zod.dev/), [Valibot](https://valibot.dev), and [ArkType](https://arktype.io/). You can generate specifications from either a [Router](/docs/router) or a [Contract](/docs/contract-first/define-contract):

:::info
Interested in support for additional schema libraries? [Let us know](https://github.com/unnoq/orpc/discussions/categories/ideas)!
:::

::: details Want to create your own JSON schema converter?
You can use any existing `X to JSON Schema` converter to add support for additional schema libraries. For example, if you want to use [Valibot](https://valibot.dev) with oRPC (if not supported), you can create a custom converter to convert Valibot schemas into JSON Schema.

```ts
import type { AnySchema } from '@orpc/contract'
import type { ConditionalSchemaConverter, JSONSchema, SchemaConvertOptions } from '@orpc/openapi'
import type { ConversionConfig } from '@valibot/to-json-schema'
import { toJsonSchema } from '@valibot/to-json-schema'

export class ValibotToJsonSchemaConverter implements ConditionalSchemaConverter {
  condition(schema: AnySchema | undefined): boolean {
    return schema !== undefined && schema['~standard'].vendor === 'valibot'
  }

  convert(schema: AnySchema | undefined, _options: SchemaConvertOptions): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    // Most JSON schema converters do not convert the `required` property separately, so returning `true` is acceptable here.
    return [true, toJsonSchema(schema as any)]
  }
}
```

:::info
It's recommended to use the built-in converters because the oRPC implementations handle many edge cases and supports every type that oRPC offers.
:::

```ts
import { OpenAPIGenerator } from '@orpc/openapi'
import {
  ZodToJsonSchemaConverter
} from '@orpc/zod' // <-- zod v3
import {
  experimental_ZodToJsonSchemaConverter as ZodToJsonSchemaConverter
} from '@orpc/zod/zod4' // <-- zod v4
import {
  experimental_ValibotToJsonSchemaConverter as ValibotToJsonSchemaConverter
} from '@orpc/valibot'
import {
  experimental_ArkTypeToJsonSchemaConverter as ArkTypeToJsonSchemaConverter
} from '@orpc/arktype'

const openAPIGenerator = new OpenAPIGenerator({
  schemaConverters: [
    new ZodToJsonSchemaConverter(), // <-- if you use Zod
    new ValibotToJsonSchemaConverter(), // <-- if you use Valibot
    new ArkTypeToJsonSchemaConverter(), // <-- if you use ArkType
  ],
})

const specFromContract = await openAPIGenerator.generate(contract, {
  info: {
    title: 'My App',
    version: '0.0.0',
  },
})

const specFromRouter = await openAPIGenerator.generate(router, {
  info: {
    title: 'My App',
    version: '0.0.0',
  },
})
```

:::warning
Features prefixed with `experimental_` are unstable and may lack some functionality.
:::

## Excluding Procedures

You can exclude a procedure from the OpenAPI specification using the `exclude` option:

```ts
const spec = await generator.generate(router, {
  exclude: (procedure, path) => !!procedure['~orpc'].route.tags?.includes('admin'),
})
```

## Operation Metadata

You can enrich your API documentation by specifying operation metadata using the `.route` or `.tag`:

```ts
const ping = os
  .route({
    summary: 'the summary',
    description: 'the description',
    deprecated: false,
    tags: ['tag'],
    successDescription: 'the success description',
    spec: { // override entire auto-generated operation object
      operationId: 'customOperationId',
      tags: ['tag'],
      summary: 'the summary',
      requestBody: {
        required: true,
        content: {
          'application/json': {},
        }
      },
      responses: {
        200: {
          description: 'customSuccessDescription',
          content: {
            'application/json': {},
          },
        }
      },
    }
  })
  .handler(() => {})

// or append tag for entire router

const router = os.tag('planets').router({
  // ...
})
```

### Customizing Operation Objects

You can also extend the operation object using the `.spec` helper for an `error` or `middleware`:

```ts
import { oo } from '@orpc/openapi'

const base = os.errors({
  UNAUTHORIZED: oo.spec({
    data: z.any(),
  }, {
    security: [{ 'api-key': [] }],
  })
})

// OR in middleware

const requireAuth = oo.spec(
  os.middleware(async ({ next, errors }) => {
    throw new ORPCError('UNAUTHORIZED')
    return next()
  }),
  {
    security: [{ 'api-key': [] }]
  }
)
```

Any [procedure](/docs/procedure) that includes the use above `errors` or `middleware` will automatically have the defined `security` property applied

:::info
The `.spec` helper accepts a callback as its second argument, allowing you to override the entire operation object.
:::

## `@orpc/zod`

### Zod v4

#### File Schema

Zod v4 includes a native `File` schema. oRPC will detect it automatically - no extra setup needed:

```ts
import * as z from 'zod'

const InputSchema = z.object({
  file: oz.file(),
  image: oz.file().mime(['image/png', 'image/jpeg']),
})
```

#### JSON Schema Customization

`description` and `examples` metadata are supported out of the box:

```ts
import * as z from 'zod'

const InputSchema = z.object({
  name: z.string(),
}).meta({
  description: 'User schema',
  examples: [{ name: 'John' }],
})
```

For further customization, you can use the `JSON_SCHEMA_REGISTRY`, `JSON_SCHEMA_INPUT_REGISTRY`, and `JSON_SCHEMA_OUTPUT_REGISTRY`:

```ts
import * as z from 'zod'
import {
  experimental_JSON_SCHEMA_REGISTRY as JSON_SCHEMA_REGISTRY,
} from '@orpc/zod/zod4'

export const InputSchema = z.object({
  name: z.string(),
})

JSON_SCHEMA_REGISTRY.add(InputSchema, {
  description: 'User schema',
  examples: [{ name: 'John' }],
  // other options...
})

JSON_SCHEMA_INPUT_REGISTRY.add(InputSchema, {
  // only for .input
})

JSON_SCHEMA_OUTPUT_REGISTRY.add(InputSchema, {
  // only for .output
})
```

### Zod v3

#### File Schema

In the [File Upload/Download](/docs/file-upload-download) guide, `z.instanceof` is used to describe file/blob schemas. However, this method prevents oRPC from recognizing file/blob schema. Instead, use the enhanced file schema approach:

```ts twoslash
import { z } from 'zod'
import { oz } from '@orpc/zod'

const InputSchema = z.object({
  file: oz.file(),
  image: oz.file().type('image/*'),
  blob: oz.blob()
})
```

#### JSON Schema Customization

If Zod alone does not cover your JSON Schema requirements, you can extend or override the generated schema:

```ts twoslash
import { z } from 'zod'
import { oz } from '@orpc/zod'

const InputSchema = oz.openapi(
  z.object({
    name: z.string(),
  }),
  {
    examples: [
      { name: 'Earth' },
      { name: 'Mars' },
    ],
    // additional options...
  }
)
```
