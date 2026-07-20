# Timeout Plugin

**Timeout Plugin** automatically aborts requests that exceed a given timeout with an `AbortError`.

## Usage

```ts
import { TimeoutLinkPlugin } from '@orpc/client/plugins'

const link = new RPCLink({
  plugins: [
    new TimeoutLinkPlugin({
      timeout: 10_000, // 10 seconds
    }),
  ],
})
```

<!--@include: @/shared/any-link-support-info.md -->

## Dynamic Timeout

The `timeout` option also accepts a function, so you can resolve the timeout per request from the interceptor options, such as the procedure `path` or the [client context](/docs/client/client-side#client-context):

```ts
const link = new RPCLink({
  plugins: [
    new TimeoutLinkPlugin({
      timeout: ({ context, path }) => context.timeout ?? 10_000,
    }),
  ],
})
```

::: info
Return `null` or `undefined` to disable the timeout, which is useful for excluding long-lived requests. Any number always enables the timeout.
:::

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/plugins/timeout.ts).
