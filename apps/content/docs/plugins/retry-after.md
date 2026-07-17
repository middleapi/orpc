# Retry After Plugin

**Retry After Plugin** automatically retries requests according to the `Retry-After` response header. This is especially useful for handling rate limits and temporary server unavailability.

## Usage

```ts
import { RetryAfterLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  plugins: [
    new RetryAfterLinkPlugin(),
  ],
})
```

<!--@include: @/shared/any-link-support-info.md -->

## Options

By default, the plugin retries only requests that receive a `429` (Too Many Requests) or `503` (Service Unavailable) status code. It times out after 5 minutes and allows up to 3 retry attempts. You can customize this behavior with the following options:

```ts
const link = new RPCLink({
  plugins: [
    new RetryAfterLinkPlugin({
      condition: response => [429, 503].includes(response.status),
      timeout: 5 * 60 * 1000, // 5 minutes
      maxAttempts: 3,
    }),
  ],
})
```

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/plugins/retry-after.ts).
