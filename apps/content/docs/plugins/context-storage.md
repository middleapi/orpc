---
title: Context Storage Plugin
description: Make oRPC Context globally accessible within request scope using AsyncLocalStorage
---

# Context Storage Plugin

The Context Storage Plugin stores the oRPC `Context` in `AsyncLocalStorage`, making it globally accessible within the request scope. This allows you to access context from anywhere in your application code without explicitly passing it through function parameters.

## When to Use

This plugin is beneficial when you need to:

- Access the oRPC context from utility functions or services without passing it as a parameter
- Implement logging, authentication checks, or audit trails that need context information
- Use third-party libraries that need access to request context
- Build middleware or decorators that operate on the current request context

::: warning Runtime Support

This plugin uses `AsyncLocalStorage` from Node.js `async_hooks`. Make sure your runtime supports it:

- **Node.js**: Supported natively
- **Cloudflare Workers**: Requires `nodejs_compat` or `nodejs_als` flag in `wrangler.toml`
- **Other runtimes**: Check AsyncLocalStorage compatibility

:::

## Setup

Add the `ContextStoragePlugin` to your server handler:

```ts twoslash
import { os } from '@orpc/server'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ContextStoragePlugin } from '@orpc/server/plugins'

type AppContext = {
  userId: string
  role: string
}

const router = os.$context<AppContext>()
// ... your routes

const handler = new OpenAPIHandler(router, {
  plugins: [new ContextStoragePlugin()]
})
```

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or custom implementations.
:::

## Usage

Once the plugin is configured, you can access the context from anywhere within the request scope using the `getContext()` function:

### Basic Usage

```ts twoslash
import { getContext } from '@orpc/server/plugins'

type AppContext = {
  userId: string
  role: string
}

// Access context from any function within the request scope
function getCurrentUser() {
  const context = getContext<AppContext>()
  return {
    id: context.userId,
    role: context.role
  }
}

function logActivity(action: string) {
  const context = getContext<AppContext>()
  console.log(`User ${context.userId} performed ${action}`)
}
```

### In Service Functions

```ts twoslash
import { getContext } from '@orpc/server/plugins'

type AppContext = {
  userId: string
  role: string
}

class UserService {
  async updateProfile(data: any) {
    const context = getContext<AppContext>()

    // Use context for authorization
    if (context.role !== 'admin' && context.userId !== data.userId) {
      throw new Error('Unauthorized')
    }

    // Implementation...
  }
}
```

### In Procedures

```ts twoslash
import { os } from '@orpc/server'
import { getContext } from '@orpc/server/plugins'

type AppContext = {
  userId: string
  role: string
}

const router = os
  .$context<AppContext>()
  .route({
    method: 'GET',
    path: '/profile',
  })
  .handler(() => {
    // Access context anywhere in the request scope
    const userInfo = getCurrentUser()
    return { userId: userInfo.id, role: userInfo.role }
  })

// Helper function using global context
function getCurrentUser() {
  const context = getContext<AppContext>()
  return {
    id: context.userId,
    role: context.role
  }
}
```

::: info
The Context Storage Plugin is inspired by [Hono's context-storage middleware](https://hono.dev/docs/middleware/builtin/context-storage) and provides similar functionality for oRPC applications.
:::
