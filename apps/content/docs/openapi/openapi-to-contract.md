---
title: OpenAPI to Contract
description: Generate an oRPC contract from an existing OpenAPI specification with the Hey API oRPC plugin.
---

# OpenAPI to Contract

If you already have an [OpenAPI Specification](https://swagger.io/specification/), you can generate an oRPC contract with [Hey API](https://heyapi.dev/)'s `orpc` plugin instead of defining the contract manually.

::: warning
The Hey API `orpc` plugin is currently beta and may introduce breaking changes while the integration stabilizes.
:::

## Example

```sh
npm install -D @hey-api/openapi-ts
```

```ts [openapi-ts.config.ts]
import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'https://get.heyapi.dev/hey-api/backend',
  output: 'src/client',
  plugins: [
    {
      name: 'orpc',
      validator: {
        input: 'zod',
      },
    },
  ],
})
```

Then run:

```sh
npx @hey-api/openapi-ts
```

This generates an oRPC-compatible contract from your OpenAPI specification. In this example, `zod` is used for generated input validation.

For more details about configuration options and plugin behavior, see the [Hey API oRPC plugin documentation](https://heyapi.dev/openapi-ts/plugins/orpc).

## What To Do Next

Once the contract is generated, what you do next depends on how you want to use it:

- Implement the contract on your own server with [Implement Contract](/docs/contract-first/implement-contract).
- Create a type-safe client with [OpenAPILink](/docs/openapi/client/openapi-link).
- Use the generated contract as a reference alongside [Define Contract](/docs/contract-first/define-contract) to better understand its structure.
