# React Native Adapter

This guide explains how to use oRPC with React Native, including the platform's supported features and current limitations.

## Fetch Link

React Native provides a built-in [Fetch API](https://reactnative.dev/docs/network), allowing you to connect to an oRPC server over HTTP. Learn more in the [Fetch Client Adapter](/docs/adapters/fetch-api#client-usage) documentation.

```ts
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({
  origin: 'https://api.example.com',
  url: '/rpc',
  headers: async ({ context }) => ({
    'x-api-key': context?.something ?? ''
  })
})
```

<!--@include: @/shared/any-link-support-info.md -->

### Limitations

The built-in `fetch` implementation in React Native does not support
[File/Blob/ReadableStream\<Uint8Array\>](/docs/binary-data) or
[AsyncIteratorObject](/docs/async-iterator-object). Follow
[Support Stream #27741](https://github.com/facebook/react-native/issues/27741)
for progress.

If you're using [Expo SDK 56 or later](https://expo.dev/changelog/sdk-56), with `expo/fetch`, you can:

- Upload [File/Blob](/docs/binary-data#file-and-blob) when they are the entire input.
- Receive [ReadableStream\<Uint8Array\>](/docs/binary-data#readablestreamuint8array) and [AsyncIteratorObject](/docs/async-iterator-object) when they are the entire output.

::: info
`expo/fetch` automatically replaces the global `fetch` from Expo SDK 56 onward, so no action is required.
:::

::: tip
If you're using [RPC Link](/docs/rpc/link), you can extend the [RPC JSON Serializer](/docs/rpc/serializer) to support additional types, including binary data, by encoding them as `base64`.
:::

## WebSocket Link

React Native also provides built-in [WebSocket](https://reactnative.dev/docs/network#websocket) support, allowing you to connect to an oRPC server over WebSocket. Learn more in the [WebSocket Client Adapter](/docs/adapters/websocket#client-usage) documentation.

```ts
import { RPCLink } from '@orpc/client/websocket'

const link = new RPCLink({
  connect: () => new WebSocket('ws://localhost:3000'),
})
```

<!--@include: @/shared/any-link-support-info.md -->
