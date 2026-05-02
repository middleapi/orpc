---
title: Beyond the Basics of Mini oRPC
description: Explore advanced features you can implement in Mini oRPC.
---

# Beyond the Basics of Mini oRPC

This section explores advanced features and techniques you can implement to enhance Mini oRPC's capabilities.

## Getting Started

The complete Mini oRPC implementation is available in the [Mini oRPC Repository](https://github.com/middleapi/mini-orpc), with a [playground](https://github.com/middleapi/mini-orpc/tree/main/playground) for testing. Once you implement a new feature, submit a pull request to the repository for review.

## Feature Suggestions

Below are recommended features you can implement in Mini oRPC:

::: info
You can implement these features in any order. Pick the ones you find interesting. You can import code from existing oRPC packages to make development easier.
:::

- [ ] [Middleware Typed Input](/docs/middleware#middleware-input) Support ([reference](https://github.com/middleapi/orpc/blob/main/packages/server/src/middleware.ts))

- [ ] Builder Variants ([reference](https://github.com/middleapi/orpc/blob/main/packages/server/src/builder-variants.ts))
  - [ ] Prevent redefinition of `.input` and `.output` methods

- [ ] [Type-Safe Error](/docs/error-handling#type%E2%80%90safe-error-handling) Support ([reference](https://github.com/middleapi/orpc/blob/main/packages/server/src/procedure-client.ts#L113-L120))

- [ ] [RPC Protocol](/docs/advanced/rpc-protocol) Implementation ([reference](https://github.com/middleapi/orpc/blob/main/packages/client/src/adapters/standard/rpc-serializer.ts))
  - [ ] Support native types like `Date`, `Map`, `Set`, etc.
  - [ ] Support `File`/`Blob` types
  - [ ] Support [Event Iterator](/docs/event-iterator) types

- [ ] Multi-runtime support
  - [ ] Standard Server Concept ([reference](https://github.com/middleapi/orpc/tree/main/packages/standard-server))
  - [ ] Fetch Adapter ([reference](https://github.com/middleapi/orpc/tree/main/packages/standard-server-fetch))
  - [ ] Node HTTP Adapter ([reference](https://github.com/middleapi/orpc/tree/main/packages/standard-server-node))
  - [ ] Peer Adapter (WebSocket, MessagePort, etc.) ([reference](https://github.com/middleapi/orpc/tree/main/packages/standard-server-peer))

- [ ] [Contract First](/docs/contract-first/define-contract) Support
  - [ ] Contract Builder ([reference](https://github.com/middleapi/orpc/blob/main/packages/contract/src/builder.ts))
  - [ ] Contract Implementer ([reference](https://github.com/middleapi/orpc/blob/main/packages/server/src/implementer.ts))

- [ ] [OpenAPI](/docs/openapi/getting-started) Support
  - [ ] OpenAPI Handler ([reference](https://github.com/middleapi/orpc/blob/main/packages/openapi/src/adapters/standard/openapi-handler.ts))
  - [ ] OpenAPI Generator ([reference](https://github.com/middleapi/orpc/blob/main/packages/openapi/src/openapi-generator.ts))
  - [ ] OpenAPI Link ([reference](https://github.com/middleapi/orpc/blob/main/packages/openapi-client/src/adapters/fetch/openapi-link.ts))

- [ ] [Tanstack Query](/docs/integrations/tanstack-query) Integration ([reference](https://github.com/middleapi/orpc/tree/main/packages/tanstack-query))
