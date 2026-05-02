---
title: Building Custom Plugins
description: Create powerful custom plugins to extend oRPC handlers and links with interceptors.
---

# Building Custom Plugins

This guide explains how to create custom oRPC plugins for handlers and links.

## What is a Plugin?

In oRPC, a plugin is a collection of `interceptors` that can work together or independently.

```ts
export class ResponseHeadersPlugin<T extends ResponseHeadersPluginContext> implements StandardHandlerPlugin<T> {
  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    options.rootInterceptors.push(async (interceptorOptions) => {
      const resHeaders = interceptorOptions.context.resHeaders ?? new Headers()

      const result = await interceptorOptions.next({
        ...interceptorOptions,
        context: {
          ...interceptorOptions.context,
          resHeaders,
        },
      })

      if (!result.matched) {
        return result
      }

      const responseHeaders = clone(result.response.headers)

      for (const [key, value] of resHeaders) {
        if (Array.isArray(responseHeaders[key])) {
          responseHeaders[key].push(value)
        }
        else if (responseHeaders[key] !== undefined) {
          responseHeaders[key] = [responseHeaders[key], value]
        }
        else {
          responseHeaders[key] = value
        }
      }

      return {
        ...result,
        response: {
          ...result.response,
          headers: responseHeaders,
        },
      }
    })
  }
}
```

Above is a snippet from the [Response Headers Plugin](/docs/plugins/response-headers). It contains a single interceptor that injects `resHeaders` into the context and merges them with the response headers after the handler executes.

### Handler Plugins

Handler plugins extend the functionality of your server-side handlers. You can create plugins for [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or any custom handlers you've built.

When building a handler plugin, you'll work with interceptors from the [Handler Lifecycle](/docs/rpc-handler#lifecycle). These interceptors let you hook into different stages of request processing - from initial request parsing to final response formatting.

Check out the [built-in handler plugins](https://github.com/middleapi/orpc/tree/main/packages/server/src/plugins) to see real-world examples of how different plugins solve common server-side challenges.

### Link Plugins

Link plugins enhance your client-side communication. They work with [RPCLink](/docs/client/rpc-link), [OpenAPILink](/docs/openapi/client/openapi-link), or custom links you've implemented.

Link plugins use interceptors from the [Link Lifecycle](/docs/client/rpc-link#lifecycle) to modify requests before they're sent or responses after they're received. This is perfect for adding authentication, logging, retry logic, or request/response transformations.

Browse the [built-in link plugins](https://github.com/middleapi/orpc/tree/main/packages/client/src/plugins) for inspiration on handling common client-side scenarios.

## Communication Between Interceptors

Sometimes you need interceptors to share data. For example, one interceptor might collect information that another interceptor uses later. You can achieve this by injecting context using a unique symbol.

The [Strict Get Method Plugin](/docs/plugins/strict-get-method) ([Source Code](https://github.com/middleapi/orpc/blob/main/packages/server/src/plugins/strict-get-method.ts)) demonstrates this pattern. It uses `rootInterceptors` to collect HTTP methods and combines this data with procedure information in `clientInterceptors` to determine whether the method is allowed.

## Plugin Order

```ts
export class ExamplePlugin<T extends Context> implements StandardHandlerPlugin<T> {
  order = 10 // [!code highlight]

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []
    options.clientInterceptors ??= []

    options.rootInterceptors.push(async ({ next }) => {
      return await next()
    })

    options.clientInterceptors.push(async ({ next }) => {
      return await next()
    })
  }
}
```

The `order` property controls plugin loading order, not interceptor execution order. To ensure your interceptor runs earlier, set a higher order value and use `.unshift` to add your interceptor, or use `.push` if you want your interceptor to run later.

::: warning
In most cases, you **should not** define the `order` property unless you need your interceptors to always run before or after other interceptors. The `order` value should be less than `1_000_000` to avoid conflicts with built-in plugins.
:::
