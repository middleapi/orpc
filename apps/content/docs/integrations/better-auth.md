---
title: Better Auth Integration
description: Seamlessly use Better Auth inside your oRPC projects without any extra overhead.
---

# Better Auth Integration

[Better Auth](https://better-auth.com/) is a framework-agnostic, universal authentication and authorization framework for TypeScript.

::: warning
This documentation assumes you are already familiar with [Better Auth](https://better-auth.com/). If you need a refresher, please review the official Better Auth documentation before proceeding.
:::

## Step 1: Define Context Headers

First, you need to access request headers in your context. You can do this either manually or by using the [Request Headers Plugin](/docs/plugins/request-headers).

### Option A: Manual Context Definition

```typescript
import { os } from '@orpc/server'

export const base = os.$context<{ headers: Headers }>()
```

::: tip
Don't forget to provide the `headers` when creating the context. This is typically done in your server adapter.
:::

### Option B: Using Request Headers Plugin

Follow the setup instructions on the [Request Headers Plugin](/docs/plugins/request-headers) page.

## Step 2: Create Auth Middleware

Create a middleware that fetches the session and user from Better Auth, validates authentication, and adds them to the context.

```typescript
import { auth } from './auth' // Your Better Auth instance
import { base } from './context'
import { ORPCError } from '@orpc/server'

export const authMiddleware = base.middleware(async ({ context, next }) => {
  const sessionData = await auth.api.getSession({
    headers: context.headers, // or reqHeaders if you're using the plugin
  })

  if (!sessionData?.session || !sessionData?.user) {
    throw new ORPCError('UNAUTHORIZED')
  }

  // Adds session and user to the context
  return next({
    context: {
      session: sessionData.session,
      user: sessionData.user
    },
  })
})
```

## Usage

Instead of using `.use(authMiddleware)` every time you create a protected procedure, you can create an `authorized` base that already includes the auth middleware:

```typescript
import { base } from './context'
import { authMiddleware } from './middlewares/auth'

export const authorized = base.use(authMiddleware)
```

Now you can use `authorized` to create procedures that require authentication:

```typescript
import { authorized } from './authorized'

export const getMessages = authorized.handler(({ context }) => {
  // context.session and context.user are guaranteed to be defined
})
```
