<div align="center">
  <image align="center" src="https://orpc.dev/logo.webp" width=280 alt="oRPC logo" />
</div>

<h1></h1>

<div align="center">
  <a href="https://codecov.io/gh/middleapi/orpc">
    <img alt="codecov" src="https://codecov.io/gh/middleapi/orpc/branch/1.x/graph/badge.svg">
  </a>
  <a href="https://www.npmjs.com/package/@orpc/vue-query">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dw/%40orpc%2Fvue-query?logo=npm" />
  </a>
  <a href="https://github.com/middleapi/orpc/blob/1.x/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/middleapi/orpc?logo=open-source-initiative" />
  </a>
  <a href="https://discord.gg/TXEbwRBvQn">
    <img alt="Discord" src="https://img.shields.io/discord/1308966753044398161?color=7389D8&label&logo=discord&logoColor=ffffff" />
  </a>
  <a href="https://deepwiki.com/middleapi/orpc">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki">
  </a>
</div>

<h3 align="center">Typesafe APIs Made Simple 🪄</h3>

**oRPC is a powerful combination of RPC and OpenAPI**, makes it easy to build APIs that are end-to-end type-safe and adhere to OpenAPI standards

---

## Highlights

- **🔗 End-to-End Type Safety**: Ensure type-safe inputs, outputs, and errors from client to server.
- **📘 First-Class OpenAPI**: Built-in support that fully adheres to the OpenAPI standard.
- **📝 Contract-First Development**: Optionally define your API contract before implementation.
- **🔍 First-Class OpenTelemetry**: Seamlessly integrate with OpenTelemetry for observability.
- **⚙️ Framework Integrations**: Seamlessly integrate with TanStack Query (React, Vue, Solid, Svelte, Angular), SWR, Pinia Colada, and more.
- **🚀 Server Actions**: Fully compatible with React Server Actions on Next.js, TanStack Start, and other platforms.
- **🔠 Standard Schema Support**: Works out of the box with Zod, Valibot, ArkType, and other schema validators.
- **🗃️ Native Types**: Supports native types like Date, File, Blob, BigInt, URL, and more.
- **⏱️ Lazy Router**: Enhance cold start times with our lazy routing feature.
- **📡 SSE & Streaming**: Enjoy full type-safe support for SSE and streaming.
- **🌍 Multi-Runtime Support**: Fast and lightweight on Cloudflare, Deno, Bun, Node.js, and beyond.
- **🔌 Extendability**: Easily extend functionality with plugins, middleware, and interceptors.

## Documentation

You can find the full documentation [here](https://orpc.dev).

## Packages

- [@orpc/contract](https://www.npmjs.com/package/@orpc/contract): Build your API contract.
- [@orpc/server](https://www.npmjs.com/package/@orpc/server): Build your API or implement API contract.
- [@orpc/client](https://www.npmjs.com/package/@orpc/client): Consume your API on the client with type-safety.
- [@orpc/openapi](https://www.npmjs.com/package/@orpc/openapi): Generate OpenAPI specs and handle OpenAPI requests.
- [@orpc/otel](https://www.npmjs.com/package/@orpc/otel): [OpenTelemetry](https://opentelemetry.io/) integration for observability.
- [@orpc/nest](https://www.npmjs.com/package/@orpc/nest): Deeply integrate oRPC with [NestJS](https://nestjs.com/).
- [@orpc/react](https://www.npmjs.com/package/@orpc/react): Utilities for integrating oRPC with React and React Server Actions.
- [@orpc/tanstack-query](https://www.npmjs.com/package/@orpc/tanstack-query): [TanStack Query](https://tanstack.com/query/latest) integration.
- [@orpc/experimental-react-swr](https://www.npmjs.com/package/@orpc/experimental-react-swr): [SWR](https://swr.vercel.app/) integration.
- [@orpc/vue-colada](https://www.npmjs.com/package/@orpc/vue-colada): Integration with [Pinia Colada](https://pinia-colada.esm.dev/).
- [@orpc/hey-api](https://www.npmjs.com/package/@orpc/hey-api): [Hey API](https://heyapi.dev/) integration.
- [@orpc/zod](https://www.npmjs.com/package/@orpc/zod): More schemas that [Zod](https://zod.dev/) doesn't support yet.
- [@orpc/valibot](https://www.npmjs.com/package/@orpc/valibot): OpenAPI spec generation from [Valibot](https://valibot.dev/).
- [@orpc/arktype](https://www.npmjs.com/package/@orpc/arktype): OpenAPI spec generation from [ArkType](https://arktype.io/).

## `@orpc/vue-query`

Integration with [Vue Query](https://tanstack.com/query/latest/docs/framework/vue/overview). Read the [documentation](https://orpc.dev/docs/integrations/tanstack-query-old/vue) for more information.

```ts
export function Setup() {
  const query = useQuery(orpc.planet.find.queryOptions({
    input: { id: 123 }, // Specify input if needed
    context: { cache: true }, // Provide client context if needed
  // additional options...
  }))

  const query = useInfiniteQuery(orpc.planet.list.infiniteOptions({
    input: (pageParam: number | undefined) => ({ limit: 10, offset: pageParam }),
    context: { cache: true }, // Provide client context if needed
    initialPageParam: undefined,
    getNextPageParam: lastPage => lastPage.nextPageParam,
  // additional options...
  }))

  const mutation = useMutation(orpc.planet.create.mutationOptions({
    context: { cache: true }, // Provide client context if needed
  // additional options...
  }))

  mutation.mutate({ name: 'Earth' })

  const queryClient = useQueryClient()

  // Invalidate all planet queries
  queryClient.invalidateQueries({
    queryKey: orpc.planet.key(),
  })

  // Invalidate only regular (non-infinite) planet queries
  queryClient.invalidateQueries({
    queryKey: orpc.planet.key({ type: 'query' })
  })

  // Invalidate the planet find query with id 123
  queryClient.invalidateQueries({
    queryKey: orpc.planet.find.key({ input: { id: 123 } })
  })
}
```

## Sponsors

If you find oRPC valuable and would like to support its development, you can do so here: [GitHub Sponsors](https://github.com/sponsors/dinwwwh).

[![oRPC sponsors](https://cdn.jsdelivr.net/gh/middleapi/static/sponsors.svg)](https://htmlpreview.github.io/?https://github.com/middleapi/static/blob/main/sponsors.svg)

## License

Distributed under the MIT License. See [LICENSE](https://github.com/middleapi/orpc/blob/1.x/LICENSE) for more information.
