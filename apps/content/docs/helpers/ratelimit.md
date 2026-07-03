# Rate Limit Helpers

Rate Limit helpers provide a unified set of adapters, middleware, and handler plugins for adding rate limiting to oRPC applications. They are flexible and composable, so you can use different rate-limiting strategies and storage backends without changing your procedure code.

## Installation

::: code-group

```sh [npm]
npm install @orpc/ratelimit@beta
```

```sh [yarn]
yarn add @orpc/ratelimit@beta
```

```sh [pnpm]
pnpm add @orpc/ratelimit@beta
```

```sh [bun]
bun add @orpc/ratelimit@beta
```

```sh [deno]
deno add npm:@orpc/ratelimit@beta
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

| Name                    | Blocking Mode | Adapter for                                                                                               |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `MemoryRateLimiter`     | ✅            | In-memory storage                                                                                         |
| `RedisRateLimiter`      | ✅            | [Redis](https://github.com/redis/redis)                                                                   |
| `UpstashRateLimiter`    | ✅            | [Upstash Rate Limit](https://www.npmjs.com/package/@upstash/ratelimit)                                    |
| `BunRedisRateLimiter`   | ✅            | [Bun's Redis](https://bun.com/docs/runtime/redis)                                                         |
| `CloudflareRateLimiter` | ❌            | [Cloudflare's Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |

::: code-group

```ts [memory]
import { MemoryRateLimiter } from '@orpc/ratelimit/memory'

const limiter = new MemoryRateLimiter({
  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: 10,

  /**
   * The duration of the fixed window in milliseconds.
   */
  window: 60000,

  blockingUntilReady: {
    /**
     * Block until the request may pass or timeout is reached.
     *
     * @default false
     */
    enabled: false,

    /**
     * milliseconds
     */
    timeout: 5000
  },
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
  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix: '',

  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: 10,

  /**
   * The duration of the fixed window in milliseconds.
   */
  window: 60000,

  blockingUntilReady: {
    /**
     * Block until the request may pass or timeout is reached.
     *
     * @default false
     */
    enabled: false,

    /**
     * milliseconds
     */
    timeout: 5000
  },
})
```

````ts [upstash]
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
  blockingUntilReady: {
    /**
     * Block until the request may pass or timeout is reached.
     *
     * @default false
     */
    enabled: false,

    /**
     * milliseconds
     */
    timeout: 5000
  },

  /**
   * For the MultiRegion setup we do some synchronizing in the background, after returning the current limit.
   * Or when analytics is enabled, we send the analytics asynchronously after returning the limit.
   * In most case you can simply ignore this.
   *
   * On Vercel Edge or Cloudflare workers, you might need `.bind` before assign:
   * ```ts
   * const ratelimiter = new UpstashRateLimiter(ratelimit, {
   *   waitUntil: ctx.waitUntil.bind(ctx),
   * })
   * ```
   */
  waitUntil: undefined
})
````

```ts [bun]
import { BunRedisRateLimiter } from '@orpc/bun'
import { redis } from 'bun'

const limiter = new BunRedisRateLimiter(redis, {
  /**
   * The prefix to use for Redis keys.
   *
   * @default ''
   */
  prefix: '',

  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: 10,

  /**
   * The duration of the fixed window in milliseconds.
   */
  window: 60000,

  blockingUntilReady: {
    /**
     * Block until the request may pass or timeout is reached.
     *
     * @default false
     */
    enabled: false,

    /**
     * milliseconds
     */
    timeout: 5000
  },
})
```

```ts [cloudflare]
import { CloudflareRateLimiter } from '@orpc/cloudflare'

export default {
  async fetch(request, env) {
    const limiter = new CloudflareRateLimiter(env.MY_RATE_LIMITER, {
      /**
       * The prefix to use for cloudflare ratelimit.
       *
       * @default ''
       */
      prefix: ''
    })
  }
}
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

```ts
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
