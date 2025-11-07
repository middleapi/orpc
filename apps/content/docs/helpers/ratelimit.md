---
title: Rate Limit
description: Rate limiting features for oRPC with multiple adapters support.
---

# Rate Limit

The Rate Limit package provides flexible rate limiting for oRPC with multiple storage backend support. It includes adapters for in-memory, Redis, and Upstash, along with middleware and plugin helpers for seamless integration.

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-ratelimit@latest
```

```sh [yarn]
yarn add @orpc/experimental-ratelimit@latest
```

```sh [pnpm]
pnpm add @orpc/experimental-ratelimit@latest
```

```sh [bun]
bun add @orpc/experimental-ratelimit@latest
```

```sh [deno]
deno add npm:@orpc/experimental-ratelimit@latest
```

:::

## Available Adapters

### Memory Adapter

A simple in-memory rate limiter using a sliding window log algorithm. Ideal for single-instance applications or development.

```ts
import { MemoryRatelimiter } from '@orpc/experimental-ratelimit/memory'

const limiter = new MemoryRatelimiter({
  maxRequests: 10, // Maximum requests allowed
  window: 60000, // Time window in milliseconds (60 seconds)
})
```

### Redis Adapter

Redis-based rate limiter using atomic Lua scripts for distributed rate limiting.

```ts
import { RedisRatelimiter } from '@orpc/experimental-ratelimit/redis'
import { Redis } from 'ioredis'

const redis = new Redis('redis://localhost:6379')

const limiter = new RedisRatelimiter({
  eval: async (script, numKeys, ...rest) => {
    return redis.eval(script, numKeys, ...rest)
  },
  maxRequests: 100,
  window: 60000,
  prefix: 'orpc:ratelimit:', // Optional key prefix
})
```

::: info
You can use any Redis client that supports Lua script evaluation by providing an `eval` function.
:::

### Upstash Adapter

Adapter for [@upstash/ratelimit](https://www.npmjs.com/package/@upstash/ratelimit), optimized for serverless environments like Vercel Edge and Cloudflare Workers.

```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { UpstashRatelimiter } from '@orpc/experimental-ratelimit/upstash-ratelimit'

const redis = Redis.fromEnv()

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'my-app:',
})

const limiter = new UpstashRatelimiter(ratelimit)
```

::: tip Edge Runtime Support
For Edge runtime like Vercel Edge or Cloudflare Workers, pass the `waitUntil` function to better handle background tasks:

```ts
const limiter = new UpstashRatelimiter(ratelimit, {
  waitUntil: ctx.waitUntil.bind(ctx),
})
```

:::

## Blocking Mode

Some adapters support blocking mode, which waits for the rate limit to reset instead of immediately rejecting requests.

```ts
const limiter = new MemoryRatelimiter({
  maxRequests: 10,
  window: 60000,
  blockingUntilReady: {
    enabled: true,
    timeout: 5000, // Wait up to 5 seconds
  },
})
```

## Manual Usage

You can use adapters directly without middleware for custom rate limiting logic:

```ts twoslash
import { MemoryRatelimiter } from '@orpc/experimental-ratelimit/memory'
import { ORPCError } from '@orpc/server'

const limiter = new MemoryRatelimiter({
  maxRequests: 5,
  window: 60000,
})

const result = await limiter.limit('user:123')

if (!result.success) {
  throw new ORPCError('TOO_MANY_REQUESTS', {
    data: {
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    },
  })
}
```

## `createRatelimitMiddleware`

The `createRatelimitMiddleware` helper creates middleware for oRPC procedures to enforce rate limits.

```ts twoslash
import { call, os } from '@orpc/server'
import { MemoryRatelimiter } from '@orpc/experimental-ratelimit/memory'
import { createRatelimitMiddleware, Ratelimiter } from '@orpc/experimental-ratelimit'
import { z } from 'zod'

const loginProcedure = os
  .$context<{ ratelimiter: Ratelimiter }>()
  .input(z.object({ email: z.email() }))
  .use(
    createRatelimitMiddleware({
      limiter: ({ context }) => context.ratelimiter,
      key: ({ context }, input) => `login:${input.email}`,
    }),
  )
  .handler(({ input }) => {
    return { success: true }
  })

const ratelimiter = new MemoryRatelimiter({
  maxRequests: 10,
  window: 60000,
})

const result = await call(
  loginProcedure,
  { email: 'user@example.com' },
  { context: { ratelimiter } }
)
```

::: info Automatic Deduplication
The `createRatelimitMiddleware` automatically deduplicates rate limit checks when the same `limiter` and `key` combination is used multiple times in a request chain. This behavior follows the [Dedupe Middleware Best Practice](/docs/best-practices/dedupe-middleware). To disable deduplication, set the `dedupe: false` option.
:::

::: tip Conditional Limiter
You can dynamically choose different limiters based on context:

```ts
const premiumLimiter = new MemoryRatelimiter({
  maxRequests: 100,
  window: 60000,
})

const standardLimiter = new MemoryRatelimiter({
  maxRequests: 10,
  window: 60000,
})

const result = await call(
  loginProcedure,
  { email: 'user@example.com' },
  {
    context: {
      ratelimiter: isPremiumUser ? premiumLimiter : standardLimiter,
    },
  },
)
```

:::

## Handler Plugin

The `RatelimitHandlerPlugin` automatically adds HTTP rate-limiting headers (`RateLimit-*` and `Retry-After`) to responses when used with middleware created by [`createRatelimitMiddleware`](#createratelimitmiddleware).

```ts
import { RatelimitHandlerPlugin } from '@orpc/experimental-ratelimit'

const handler = new RPCHandler(router, {
  plugins: [
    new RatelimitHandlerPlugin(),
  ],
})
```

::: info
You can combine this plugin with [Retry After Plugin](/docs/plugins/retry-after) to enable automatic client-side retries based on server rate-limiting headers.
:::

::: info
The `handler` can be any supported oRPC handler, such as [RPCHandler](/docs/rpc-handler), [OpenAPIHandler](/docs/openapi/openapi-handler), or other custom handlers.
:::
