# Rate Limit Helpers

Rate Limit helpers provide a unified set of adapters, middleware, and handler plugins for adding rate limiting to oRPC applications. They are flexible and composable, so you can use different rate-limiting strategies and storage backends without changing your procedure code.

## Installation

::: code-group

```sh [npm]
npm install @orpc/ratelimit@latest
```

```sh [yarn]
yarn add @orpc/ratelimit@latest
```

```sh [pnpm]
pnpm add @orpc/ratelimit@latest
```

```sh [bun]
bun add @orpc/ratelimit@latest
```

```sh [deno]
deno add npm:@orpc/ratelimit@latest
```

:::

## Basic Usage

The core concept is the `RateLimiter` interface, which defines a standard way to check and enforce rate limits. You can create your own custom limiter or use one of the provided adapters for popular storage backends. The `limit` method accepts a key and an optional `weight` value, which defaults to `1`, so a single request can consume multiple points.

```ts twoslash
import { MemoryRateLimiter } from '@orpc/ratelimit/memory'
// ---cut---
import { ORPCError } from '@orpc/server'

const limiter = new MemoryRateLimiter({
  maxRequests: 5,
  window: 60000,
})

const result = await limiter.limit('user:123', { weight: 2 })

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

## Adapters

The package includes adapters for multiple storage backends and runtimes.
Each adapter might require `maxRequests` and `window` to configure the limit, along with adapter specific options.

| Name                    | Blocking Mode | Adapter for                                                                                                 |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `MemoryRateLimiter`     | ✅            | In-memory storage                                                                                           |
| `RedisRateLimiter`      | ✅            | [Redis](https://github.com/redis/redis)                                                                     |
| `UpstashRateLimiter`    | ✅            | [Upstash Rate Limit](https://www.npmjs.com/package/@upstash/ratelimit)                                      |
| `CloudflareRateLimiter` |               | [Cloudflare RateLimit Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |

::: code-group

```ts [memory]
import { MemoryRateLimiter } from '@orpc/ratelimit/memory'

const limiter = new MemoryRateLimiter({
  maxRequests: 10, // Maximum requests allowed
  window: 60000, // Time window in milliseconds (60 seconds)
})
```

```ts [redis]
import { RedisRateLimiter } from '@orpc/ratelimit/redis'
import { createClient } from 'redis'

const client = createClient({ url: 'redis://localhost:6379' })

// RedisRateLimiter lazily connects to Redis when needed.
// You can still call `client.connect()` manually, but it is optional.
await client.connect()

const limiter = new RedisRateLimiter(client, {
  prefix: 'orpc:', // Optional Redis key prefix
  maxRequests: 10, // Maximum requests allowed
  window: 60000, // Time window in milliseconds (60 seconds)
})
```

```ts [cloudflare]
import { CloudflareRateLimiter } from '@orpc/ratelimit/cloudflare'

export default {
  async fetch(request, env) {
    // env.MY_RATE_LIMITER is a Cloudflare Workers Rate Limiting binding
    // https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

    const limiter = new CloudflareRateLimiter(env.MY_RATE_LIMITER, {
      prefix: 'orpc:', // Optional key prefix
    })
  }
}
```

```ts [upstash]
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { UpstashRateLimiter } from '@orpc/ratelimit/upstash'

const redis = Redis.fromEnv()
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'orpc:', // Optional key prefix
})

const limiter = new UpstashRateLimiter(ratelimit, {
  waitUntil: ctx.waitUntil.bind(ctx), // Pass waitUntil for Edge runtime support
})
```

:::

### Blocking Mode

Some adapters support blocking mode, which waits until capacity becomes available instead of rejecting requests immediately.

```ts
const limiter = new MemoryRateLimiter({
  maxRequests: 10,
  window: 60000,
  blockingUntilReady: {
    enabled: true, // Disabled by default
    timeout: 5000, // Wait up to 5 seconds
  },
})
```

## Ratelimit Middleware

The `ratelimit` helper creates middleware that enforces rate limits for [procedures](/docs/procedure).

```ts twoslash
import { ratelimit, RateLimiter } from '@orpc/ratelimit'

const procedure = os
  .$context<{ ratelimiter: RateLimiter }>()
  .input(z.object({ email: z.email() }))
  .use(
    ratelimit({
      limiter: ({ context }) => context.ratelimiter,
      key: ({ context }, input) => `login:${input.email}`,
      weight: 1, // Optional weight for each request, default is 1
    }),
  )
  .handler(({ input }) => {
    return { success: true }
  })

const ratelimiter = new MemoryRateLimiter({
  maxRequests: 10,
  window: 60000,
})

const result = await call(
  procedure,
  { email: 'user@example.com' },
  { context: { ratelimiter } }
)
```

::: info Automatic Deduplication
When the same `limiter` and `key` combination is used multiple times in a single request chain, the `ratelimit` middleware performs the rate limit check only once. This behavior follows the [Dedupe Middleware Best Practice](/docs/best-practices/dedupe-middleware). To disable deduplication, set `dedupe: false`.
:::

::: tip Conditional Limiter
You can choose different limiters dynamically based on the request context:

```ts
const premiumLimiter = new MemoryRateLimiter({
  maxRequests: 100,
  window: 60000,
})

const standardLimiter = new MemoryRateLimiter({
  maxRequests: 10,
  window: 60000,
})

const result = await call(
  procedure,
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

The `RateLimitHandlerPlugin` automatically adds HTTP rate limiting headers (`RateLimit-*` and `Retry-After`) to responses when used with [Ratelimit Middleware](#ratelimit-middleware). This lets clients inspect the current limit state and know when they can retry after hitting a limit.

```ts
import { RateLimitHandlerPlugin } from '@orpc/ratelimit'

const handler = new RPCHandler(router, {
  plugins: [
    new RateLimitHandlerPlugin(),
  ],
})
```

::: info
You can combine this plugin with [Retry After Plugin](/docs/plugins/retry-after) to enable automatic client-side retries based on server rate limiting headers.
:::

<!--@include: @/shared/common-plugin-handler-compatibility.md -->
