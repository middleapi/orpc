---
title: Implement Contract in NestJS
description: Seamlessly implement oRPC contracts in your NestJS projects.
---

# Implement Contract in NestJS

This guide explains how to easily implement [oRPC contract](/docs/contract-first/define-contract) within your [NestJS](https://nestjs.com/) application using `@orpc/nest`.

## Installation

::: code-group

```sh [npm]
npm install @orpc/nest@latest
```

```sh [yarn]
yarn add @orpc/nest@latest
```

```sh [pnpm]
pnpm add @orpc/nest@latest
```

```sh [bun]
bun add @orpc/nest@latest
```

```sh [deno]
deno add npm:@orpc/nest@latest
```

:::

## Requirements

oRPC is an ESM-only library. Therefore, your NestJS application must be configured to support ESM modules.

1.  **Configure `tsconfig.json`**: with `"module": "NodeNext"` or a similar ESM-compatible option.

    ```json
    {
      "compilerOptions": {
        "module": "NodeNext", // <-- this is recommended
        "strict": true // <-- this is recommended
        // ... other options,
      }
    }
    ```

2.  **Node.js Environment**:
    - **Node.js 22+**: Recommended, as it allows `require()` of ESM modules natively.
    - **Older Node.js versions**: Alternatively, use a bundler to compile ESM modules (including `@orpc/nest`) to CommonJS.

    ::: warning
    By default, NestJS bundler ([Webpack](https://webpack.js.org/) or [SWC](https://swc.rs/)) might not compile `node_modules`. You may need to adjust your bundler configs to include `@orpc/nest` for compilation.
    :::

## Define Your Contract

Before implementation, define your oRPC contract. This process is consistent with the standard oRPC methodology. For detailed guidance, refer to the main [Contract-First guide](/docs/contract-first/define-contract).

::: details Example Contract

```ts
import { oc, populateContractRouterPaths } from '@orpc/contract'
import * as z from 'zod'

export const PlanetSchema = z.object({
  id: z.number().int().min(1),
  name: z.string(),
  description: z.string().optional(),
})

export const listPlanetContract = oc
  .route({
    method: 'GET',
    path: '/planets' // Path is required for NestJS implementation
  })
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().min(0).default(0),
    }),
  )
  .output(z.array(PlanetSchema))

export const findPlanetContract = oc
  .route({
    method: 'GET',
    path: '/planets/{id}' // Path is required
  })
  .input(PlanetSchema.pick({ id: true }))
  .output(PlanetSchema)

export const createPlanetContract = oc
  .route({
    method: 'POST',
    path: '/planets' // Path is required
  })
  .input(PlanetSchema.omit({ id: true }))
  .output(PlanetSchema)

/**
 * populateContractRouterPaths is completely optional,
 * because the procedure's path is required for NestJS implementation.
 * This utility automatically populates any missing paths
 * Using the router's keys + `/`.
 */
export const contract = populateContractRouterPaths({
  planet: {
    list: listPlanetContract,
    find: findPlanetContract,
    create: createPlanetContract,
  },
})
```

:::

::: warning
For a contract to be implementable in NestJS using `@orpc/nest`, each contract **must** define a `path` in its `.route`. Omitting it will cause a build‑time error.
You can avoid this by using the `populateContractRouterPaths` utility to automatically fill in any missing paths.
:::

## Path Parameters

Aside from [oRPC Path Parameters](/docs/openapi/routing#path-parameters), regular NestJS route patterns still work out of the box. However, they are not standard in OpenAPI, so we recommend using oRPC Path Parameters exclusively.

::: warning
[oRPC Path Parameter matching with slashes (/)](/docs/openapi/routing#path-parameters) does not work on the NestJS Fastify platform, because Fastify does not allow wildcard (`*`) aliasing in path parameters.
:::

## Implement Your Contract

```ts
import { Implement, implement, ORPCError } from '@orpc/nest'

@Controller()
export class PlanetController {
  /**
   * Implement a standalone procedure
   */
  @Implement(contract.planet.list)
  list() {
    return implement(contract.planet.list).handler(({ input }) => {
      // Implement logic here

      return []
    })
  }

  /**
   * Implement entire contract
   */
  @Implement(contract.planet)
  planet() {
    return {
      list: implement(contract.planet.list).handler(({ input }) => {
        // Implement logic here
        return []
      }),
      find: implement(contract.planet.find).handler(({ input }) => {
        // Implement logic here
        return {
          id: 1,
          name: 'Earth',
          description: 'The planet Earth',
        }
      }),
      create: implement(contract.planet.create).handler(({ input }) => {
        // Implement logic here
        return {
          id: 1,
          name: 'Earth',
          description: 'The planet Earth',
        }
      }),
    }
  }

  // other handlers...
}
```

::: info
The `@Implement` decorator functions similarly to NestJS built-in HTTP method decorators (e.g., `@Get`, `@Post`). Handlers decorated with `@Implement` are standard NestJS controller handlers and can leverage all NestJS features.
:::

## Body Parser

By default, NestJS parses request bodies for `application/json` and `application/x-www-form-urlencoded` content types. However:

- NestJS `urlencoded` parser does not support [Bracket Notation](/docs/openapi/bracket-notation) like in standard oRPC parsers.
- In some edge cases like uploading a file with `application/json` content type, the NestJS parser does not treat it as a file, instead it parses the body as a JSON string.

Therefore, we **recommend** disabling the NestJS body parser:

```ts
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // [!code highlight]
  })

  await app.listen(process.env.PORT ?? 3000)
}
```

::: info
oRPC will use NestJS parsed body when it's available, and only use the oRPC parser if the body is not parsed by NestJS.
:::

## Configuration

Configure the `@orpc/nest` module by importing `ORPCModule` in your NestJS application:

```ts
import { Module } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { onError, ORPCError, ORPCModule } from '@orpc/nest'
import { Request } from 'express' // if you use express adapter
import {
  experimental_RethrowHandlerPlugin as RethrowHandlerPlugin,
} from '@orpc/server/plugins'

declare module '@orpc/nest' {
  /**
   * Extend oRPC global context to make it type-safe inside your handlers/middlewares
   */
  interface ORPCGlobalContext {
    request: Request
  }
}

@Module({
  imports: [
    ORPCModule.forRootAsync({ // or use .forRoot for static config
      useFactory: (request: Request) => ({
        interceptors: [
          onError((error) => {
            console.error(error)
          }),
        ],
        context: { request }, // oRPC context, accessible from middlewares, etc.
        eventIteratorKeepAliveInterval: 5000, // 5 seconds
        customJsonSerializers: [],
        plugins: [
          new RethrowHandlerPlugin({
            filter: (error) => {
              // Rethrow all non-ORPCError errors
              // This allows unhandled exceptions to bubble up to NestJS global exception filters
              return !(error instanceof ORPCError)
            },
          })
        ], // most oRPC plugins are compatible
      }),
      inject: [REQUEST],
    }),
  ],
})
export class AppModule {}
```

::: info

- **`interceptors`** - [Server-side client interceptors](/docs/client/server-side#lifecycle) for intercepting input, output, and errors.
- **`eventIteratorKeepAliveInterval`** - Keep-alive interval for event streams (see [Event Iterator Keep Alive](/docs/rpc-handler#event-iterator-keep-alive))

:::

## Create a Type-Safe Client

When you implement oRPC contracts in NestJS using `@orpc/nest`, the resulting API endpoints are OpenAPI compatible. This allows you to use an OpenAPI-compatible client link, such as [OpenAPILink](/docs/openapi/client/openapi-link), to interact with your API in a type-safe way.

```typescript
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { ContractRouterClient } from '@orpc/contract'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'

const link = new OpenAPILink(contract, {
  url: 'http://localhost:3000',
  headers: () => ({
    'x-api-key': 'my-api-key',
  }),
  // fetch: <-- polyfill fetch if needed
})

const client: JsonifiedClient<ContractRouterClient<typeof contract>> = createORPCClient(link)
```

::: info
Please refer to the [OpenAPILink](/docs/openapi/client/openapi-link) documentation for more information on client setup and options.
:::

## Advanced

### Custom Send Response

By default, oRPC sends the response directly without returning it to the NestJS handler. However, you may want to preserve the return behavior for compatibility with certain NestJS features or third-party libraries.

```ts
import { Module } from '@nestjs/common'
import { ORPCModule } from '@orpc/nest'
import { Response } from 'express' // if you use express adapter
import { isObject } from '@orpc/shared' // checks if value is a plain object (not a class instance)

@Module({
  imports: [
    ORPCModule.forRoot({
      sendResponseInterceptors: [
        async ({ response, standardResponse, next }) => {
          if (
            standardResponse.status < 200
            || standardResponse.status >= 300
            || !(isObject(standardResponse.body) || Array.isArray(standardResponse.body))
          ) {
            // Only object and array are valid to return as response body
            // the rest should fallback to default oRPC behavior
            return next()
          }

          const expressResponse = response as Response
          expressResponse.status(standardResponse.status)
          for (const [key, value] of Object.entries(standardResponse.headers)) {
            if (value !== undefined) {
              expressResponse.setHeader(key, value)
            }
          }

          return standardResponse.body
        },
      ],
    }),
  ],
})
export class AppModule {}
```
