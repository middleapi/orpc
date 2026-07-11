# OpenAPI Reference Plugin (Swagger/Scalar)

This plugin serves API reference documentation powered by [Scalar](https://github.com/scalar/scalar) or [Swagger UI](https://swagger.io/tools/swagger-ui/), and exposes the OpenAPI specification as JSON.

::: info
This plugin depends on the [OpenAPI Generator](/docs/openapi/specification). Review that guide before setting up the reference plugin.
:::

## Setup

To use this plugin, first create an [OpenAPI Generator](/docs/openapi/specification). The plugin uses it to generate the OpenAPI specification.

```ts
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'

const generator = new OpenAPIGenerator({
  converters: [
    new ZodToJsonSchemaConverter(),
  ],
})

const handler = new OpenAPIHandler(router, {
  plugins: [
    new OpenAPIReferencePlugin({
      spec: () => generator.generateSpec(router, {
        info: {
          title: 'ORPC Playground',
          version: '1.0.0',
        },
        servers: [
          { url: 'https://api.example.com/v1', },
        ],
      }),
    }),
  ]
})
```

::: info
By default, the API reference UI is served from `/`, and the OpenAPI specification is served from `/spec.json`. Use `docsPath` and `specPath` to change these routes.
:::

## Provider

[Scalar](https://github.com/scalar/scalar) is the default provider. To use [Swagger UI](https://swagger.io/tools/swagger-ui/) instead, set `provider` to `'swagger'`. Use `providerConfig` to pass provider-specific options.

```ts
const handler = new OpenAPIHandler(router, {
  plugins: [
    new OpenAPIReferencePlugin({
      provider: 'swagger',
      providerConfig: {
        // Swagger UI specific configuration
      },
    }),
  ]
})
```

::: tip
To make `providerConfig` typesafe, install the type definitions for your chosen provider:

::: code-group

```sh [scalar]
npm install @scalar/api-reference
```

```sh [swagger]
npm install swagger-ui @types/swagger-ui
```

:::

::: info
You can also load custom assets for the docs UI by setting `providerScriptUrl` and `providerCssUrl`.
:::

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/openapi/src/plugins/openapi-reference.ts).
