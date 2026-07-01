# Implement oRPC contract with NestJS

oRPC provides built-in support for NestJS applications through the `@orpc/nest` package. It lets you implement [oRPC contracts](/docs/contract/router) in NestJS while maintaining type safety and OpenAPI compatibility.

## Installation

::: code-group

```sh [npm]
npm install @orpc/nest@beta
```

```sh [yarn]
yarn add @orpc/nest@beta
```

```sh [pnpm]
pnpm add @orpc/nest@beta
```

```sh [bun]
bun add @orpc/nest@beta
```

```sh [deno]
deno add npm:@orpc/nest@beta
```

:::

## Requirements

oRPC is an ESM-only library, but NestJS versions below v12 do not natively support ESM. You might need to configure your project for ESM and use a Node.js version that supports `require()` for ESM modules (Node.js 22+ is recommended). The following configuration is recommended:

```json [tsconfig.json]
{
  "compilerOptions": {
    "module": "NodeNext", // <- recommended
    "strict": true // <- recommended
    // ... other options
  }
}
```

## Define Your Contract

Before implementation, define your [contract](/docs/contract/procedure) as usual, including [routing](/docs/openapi/routing). There is no special requirement, except that each contract must define an `openapi.path` meta.

```ts
import { oc } from '@orpc/contract'
import { openapi, populateRouterContractOpenAPIPaths } from '@orpc/openapi'

const example = oc.meta(openapi({
  path: '/example' // [!code highlight]
}))

// or using the `populateRouterContractOpenAPIPaths` helper to
// automatically populate OpenAPI paths for all contracts
const contract = populateRouterContractOpenAPIPaths({
  example
})
```

## Implement Your Contract

To implement your contract in NestJS, use the `@Implement` decorator and the `implement` function. The `@Implement` very similar to NestJS built-in HTTP method decorators (e.g., `@Get`, `@Post`) and can be used to implement either a single procedure contract or an router contract or combine with other NestJS decorators.

```ts
import { Implement } from '@orpc/nest'
import { implement, ORPCError } from '@orpc/server'

@Controller()
export class PlanetController {
  /**
   * Implement a procedure contract
   */
  @Implement(contract.planet.list)
  list() {
    return implement(contract.planet.list).handler(({ input }) => {
      // Implement logic here
    })
  }

  /**
   * Implement a router contract
   */
  @Implement(contract.planet)
  planet() {
    return {
      list: implement(contract.planet.list).handler(({ input }) => {
        // Implement logic here
      }),
      find: implement(contract.planet.find).handler(({ input }) => {
        // Implement logic here
      }),
      create: implement(contract.planet.create).handler(({ input }) => {
        // Implement logic here
      }),
    }
  }

  // other handlers...
}
```

::: warning
If you using `@Implement` decorator for router contract, underhook it creates corresponding NestJS method for each procedure contract. Therefore, all other decorator should be applied before `@Implement` decorator, otherwise it will not be applied to corresponding NestJS methods.

```ts
@Controller()
export class PlanetController {
  @Implement(contract.planet) // ⬇️ other decorators should be below this line
  @UseGuards(AuthGuard)
  planet(@Req() req: Request) {
    return {
      // your implementation
    }
  }
}
```

:::

## Error Handling

By default, errors thrown in implemented procedures are caught and handled by oRPC, which then rethrows a generic `HttpException` to NestJS. If you want NestJS to catch the original error instead of `HttpException`, use the [Rethrow Plugin](/docs/plugins/rethrow) to bypass oRPC error handling and let NestJS handle the error directly.

## Body Parser

oRPC uses bodies parsed by NestJS when available, and falls back to its own parser otherwise. In some cases, you may want to disable the NestJS body parser so oRPC can handle parsing directly:

- NestJS `urlencoded` parsing does not support [Bracket Notation](/docs/openapi/bracket-notation).
- File uploads with common content types like `application/json` may not be parsed as `File` instances.

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

## Configuration

Configure `@orpc/nest` by importing `ORPCModule` into your NestJS module. It supports the same
options as the [OpenAPI Handler](/docs/openapi/handler), except for options that are unrelated to NestJS and options that are specific to NestJS.

```ts
import { onError } from '@orpc/server'
import { ORPCModule } from '@orpc/nest'

@Module({
  imports: [
    ORPCModule.forRoot({
      interceptors: [
        onError((error) => {
          console.error(error)
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

### Initial Context

To define [initial context](/docs/context#initial-context) for use in oRPC scopes, extend the `DefaultInitialContext` interface and provide `context` through `ORPCModule.forRootAsync` (or `ORPCModule.forRoot` for static configuration).

```ts
declare module '@orpc/server' {
  /**
   * Extend the context interface to enable typesafe access across oRPC scopes
   */
  interface DefaultInitialContext {
    request: Request // [!code highlight]
  }
}

@Module({
  imports: [
    ORPCModule.forRootAsync({
      inject: [REQUEST],
      useFactory: (request: Request) => ({
        context: { request }, // [!code highlight]
      }),
    }),
  ],
})
export class AppModule {}
```

### Plugins

Most handler plugins also work in NestJS, for example [Request Headers](/docs/plugins/request-headers), [Response Headers](/docs/plugins/response-headers), [Rethrow](/docs/plugins/rethrow), and [Smart Coercion](/docs/plugins/smart-coercion).

```ts
@Module({
  imports: [
    ORPCModule.forRoot({
      plugins: [
        new RethrowHandlerPlugin({
          // Bypass oRPC error handling and let NestJS handle the error instead
          filter: error => !(error instanceof ORPCError)
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

::: warning
Procedures run only when a matching NestJS controller method is called. If no route matches (404), neither the procedure nor its plugins run. As a result, plugins like [OpenAPI Reference](/docs/plugins/openapi-reference) may not work as expected, since NestJS can respond with 404 before the procedure runs.
:::

### Event Stream Options

Configure how [event iterators](/docs/event-iterator) are streamed to the client using the `toNestResponse.eventStream` options.

```ts
@Module({
  imports: [
    ORPCModule.forRoot({
      toNestResponse: {
        eventStream: {
          initialComment: {
            /**
             * If true, an initial comment is sent immediately upon stream start to flush headers.
             * This allows the receiving side to establish the connection without waiting for the first event.
             *
             * @default true
             */
            enabled: true,
            /**
             * The content of the initial comment sent upon stream start. Must not include newline characters.
             *
             * @default ''
             */
            comment: '',
          },
          keepAlive: {
            /**
             * If true, a ping comment is sent periodically to keep the connection alive.
             *
             * @default true
             */
            enabled: true,
            /**
             * Interval (in milliseconds) between ping comments sent after the last event.
             *
             * @default 5000
             */
            interval: 5000,
            /**
             * The content of the ping comment. Must not include newline characters.
             *
             * @default ''
             */
            comment: '',
          },
          /**
           * If true, a `close` event is sent even when the iterator completes with `undefined`.
           * When the iterator returns a value, a `close` event is always emitted regardless of this setting.
           *
           * @default true
           */
          emptyCloseEventEnabled: true,
        },
      },
    }),
  ],
})
export class AppModule {}
```

### `toNestStandardLazyRequest` option

By default, `@orpc/nest` supports the Express and Fastify adapters. If you use another adapter, you may need to customize how a NestJS request is converted into a standard request (including additional params). For details, see [Standard Server](http://standardserver.dev/).

```ts
import { NestStandardLazyRequest } from '@orpc/nest'
import { toStandardLazyRequest } from '@standardserver/fetch'

@Module({
  imports: [
    ORPCModule.forRoot({
      toNestStandardLazyRequest: (req, res) => {
        // example Hono platform support
        const standardRequest: NestStandardLazyRequest = toStandardLazyRequest(req.raw)
        standardRequest.params = req.params
        return standardRequest
      },
    }),
  ],
})
export class AppModule {}
```

## Typesafe Client

After implementing your contract in NestJS, you can use the same contract to create a typesafe client. See [OpenAPI Link](/docs/openapi/link) for more details.
