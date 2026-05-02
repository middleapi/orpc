---
title: Learn & Contribute
description: Discover how to learn and contribute to the oRPC project, including advanced guides and contributor resources.
---

# Learn & Contribute

Welcome to the **Learn & Contribute** section! Here you can explore advanced guides and resources to deepen your understanding of oRPC and contribute to its development.

::: info
[oRPC DeepWiki](https://deepwiki.com/middleapi/orpc) provides an excellent overview of the oRPC project, where you can interact with an AI assistant to learn more about the codebase and get detailed insights.
:::

## Architecture Overview

Each part of oRPC serves a specific purpose in the overall system. The source files linked below provide detailed implementation insights for contributors.

### Procedure Builder/Caller

The core developer experience of oRPC. This lightweight component consists of just a few files that enable you to define and call procedures within the same environment.

- [server/src/builder.ts](https://github.com/middleapi/orpc/blob/main/packages/server/src/builder.ts)
- [server/src/procedure-decorated.ts](https://github.com/middleapi/orpc/blob/main/packages/server/src/procedure-decorated.ts)
- [server/src/procedure-client.ts](https://github.com/middleapi/orpc/blob/main/packages/server/src/procedure-client.ts)

### Contract First

Extends the **Procedure Builder/Caller** by separating contract definition from implementation, enabling contract-first development.

- [contract/src/builder.ts](https://github.com/middleapi/orpc/blob/main/packages/contract/src/builder.ts)
- [server/src/implementer.ts](https://github.com/middleapi/orpc/blob/main/packages/server/src/implementer.ts)

### Standard Server

Abstracts runtime environments, allowing oRPC adapters to run seamlessly across Cloudflare Workers, Node.js, Bun, Deno, and other platforms without runtime-specific concerns.

- [standard-server](https://github.com/middleapi/orpc/tree/main/packages/standard-server)
- [standard-server-fetch](https://github.com/middleapi/orpc/tree/main/packages/standard-server-fetch)
- [standard-server-node](https://github.com/middleapi/orpc/tree/main/packages/standard-server-node)
- [standard-server-fastify](https://github.com/middleapi/orpc/tree/main/packages/standard-server-fastify)
- [standard-server-aws-lambda](https://github.com/middleapi/orpc/tree/main/packages/standard-server-aws-lambda)
- [standard-server-peer](https://github.com/middleapi/orpc/tree/main/packages/standard-server-peer)

### RPC Handler/Link

Implements the [RPC Protocol](/docs/advanced/rpc-protocol) for efficient and lightweight remote procedure invocation. Supports native types like `Date`, `Map`, `Set`, `BigInt`, and more.

- [client/src/adapters/standard/rpc-link.ts](https://github.com/middleapi/orpc/blob/main/packages/client/src/adapters/standard/rpc-link.ts)
- [server/src/adapters/standard/rpc-handler.ts](https://github.com/middleapi/orpc/blob/main/packages/server/src/adapters/standard/rpc-handler.ts)

### OpenAPI Handler/Link/Generator

Implements OpenAPI support for standards-compliant remote procedure invocation following the [OpenAPI Specification](https://swagger.io/specification/).

- [openapi-client/src/adapters/standard/openapi-link.ts](https://github.com/middleapi/orpc/blob/main/packages/openapi-client/src/adapters/standard/openapi-link.ts)
- [openapi/src/adapters/standard/openapi-handler.ts](https://github.com/middleapi/orpc/blob/main/packages/openapi/src/adapters/standard/openapi-handler.ts)
- [openapi/src/openapi-generator.ts](https://github.com/middleapi/orpc/blob/main/packages/openapi/src/openapi-generator.ts)

## Contributing

We welcome contributions to oRPC! To get started, please review our [contributing guidelines](https://github.com/middleapi/orpc/blob/main/CONTRIBUTING.md).
