---
title: Playgrounds
description: Interactive development environments for exploring and testing oRPC functionality.
---

# Playgrounds

Explore oRPC implementations through our interactive playgrounds,
featuring pre-configured examples accessible instantly via StackBlitz or local setup.

## Available Playgrounds

| Environment                      | StackBlitz                                                                                             | GitHub Source                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Next.js Playground               | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/next)              | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/next)                      |
| TanStack Start Playground        | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/tanstack-start)    | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/tanstack-start)            |
| Nuxt.js Playground               | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/nuxt)              | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/nuxt)                      |
| Solid Start Playground           | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/solid-start)       | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/solid-start)               |
| Svelte Kit Playground            | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/svelte-kit)        | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/svelte-kit)                |
| Astro Playground                 | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/astro)             | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/astro)                     |
| Contract-First Playground        | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/contract-first)    | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/contract-first)            |
| NestJS Playground                | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/nest)              | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/nest)                      |
| Cloudflare Worker                | [Open in StackBlitz](https://stackblitz.com/github/unnoq/orpc/tree/main/playgrounds/cloudflare-worker) | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/cloudflare-worker)         |
| Bun WebSocket + OpenTelemetry    |                                                                                                        | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/bun-websocket-otel)        |
| Electron Playground              |                                                                                                        | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/electron)                  |
| Browser Extension Playground     |                                                                                                        | [View Source](https://github.com/unnoq/orpc/tree/main/playgrounds/browser-extension)         |
| Vue + Bun + Monorepo (Community) |                                                                                                        | [View Source](https://github.com/hunterwilhelm/orpc-community-playgrounds/tree/main/vue-bun) |

:::warning
StackBlitz has own limitations, so some features may not work as expected.
:::

## Local Development

If you prefer working locally, you can clone any playground using the following commands:

```bash
npx degit unnoq/orpc/playgrounds/next orpc-next-playground
npx degit unnoq/orpc/playgrounds/tanstack-start orpc-tanstack-start-playground
npx degit unnoq/orpc/playgrounds/nuxt orpc-nuxt-playground
npx degit unnoq/orpc/playgrounds/solid-start orpc-solid-start-playground
npx degit unnoq/orpc/playgrounds/svelte-kit orpc-svelte-kit-playground
npx degit unnoq/orpc/playgrounds/astro orpc-astro-playground
npx degit unnoq/orpc/playgrounds/contract-first orpc-contract-first-playground
npx degit unnoq/orpc/playgrounds/nest orpc-nest-playground
npx degit unnoq/orpc/playgrounds/cloudflare-worker orpc-cloudflare-worker-playground
npx degit unnoq/orpc/playgrounds/bun-websocket-otel orpc-bun-websocket-otel-playground
npx degit unnoq/orpc/playgrounds/electron orpc-electron-playground
npx degit unnoq/orpc/playgrounds/browser-extension orpc-browser-extension-playground

# Community (clone at your own risk)
npx degit hunterwilhelm/orpc-community-playgrounds/vue-bun orpc-vue-bun-monorepo-playground
```

For each project, set up the development environment:

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

That's it! You can now access the playground at `http://localhost:3000`.
