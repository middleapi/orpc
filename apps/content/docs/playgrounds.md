---
title: Playgrounds
description: Interactive development environments for exploring and testing oRPC functionality.
---

# Playgrounds

Explore oRPC implementations through our interactive playgrounds,
featuring pre-configured examples accessible instantly via StackBlitz or local setup.

## Available Playgrounds

| Environment                      | StackBlitz                                                                                                | GitHub Source                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Next.js Playground               | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/next)              | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/next)                 |
| TanStack Start Playground        | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/tanstack-start)    | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/tanstack-start)       |
| Nuxt.js Playground               | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/nuxt)              | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/nuxt)                 |
| Solid Start Playground           | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/solid-start)       | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/solid-start)          |
| Svelte Kit Playground            | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/svelte-kit)        | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/svelte-kit)           |
| Astro Playground                 | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/astro)             | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/astro)                |
| Contract-First Playground        | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/contract-first)    | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/contract-first)       |
| NestJS Playground                | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc-nest/tree/1.x/playgrounds/nest)         | [View Source](https://github.com/middleapi/orpc-nest/tree/1.x/playgrounds/nest)            |
| Cloudflare Worker                | [Open in StackBlitz](https://stackblitz.com/github/middleapi/orpc/tree/1.x/playgrounds/cloudflare-worker) | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/cloudflare-worker)    |
| Bun WebSocket + OpenTelemetry    |                                                                                                           | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/bun-websocket-otel)   |
| Electron Playground              |                                                                                                           | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/electron)             |
| Browser Extension Playground     |                                                                                                           | [View Source](https://github.com/middleapi/orpc/tree/1.x/playgrounds/browser-extension)    |
| Multiservice Monorepo Playground |                                                                                                           | [View Source](https://github.com/middleapi/orpc-multiservice-monorepo-playground/tree/1.x) |

:::warning
StackBlitz has own limitations, so some features may not work as expected.
:::

## Local Development

If you prefer working locally, you can clone any playground using the following commands:

```bash
npx giget gh:middleapi/orpc/playgrounds/next#1.x orpc-next-playground
npx giget gh:middleapi/orpc/playgrounds/tanstack-start#1.x orpc-tanstack-start-playground
npx giget gh:middleapi/orpc/playgrounds/nuxt#1.x orpc-nuxt-playground
npx giget gh:middleapi/orpc/playgrounds/solid-start#1.x orpc-solid-start-playground
npx giget gh:middleapi/orpc/playgrounds/svelte-kit#1.x orpc-svelte-kit-playground
npx giget gh:middleapi/orpc/playgrounds/astro#1.x orpc-astro-playground
npx giget gh:middleapi/orpc/playgrounds/contract-first#1.x orpc-contract-first-playground
npx giget gh:middleapi/orpc-nest/playgrounds/nest#1.x orpc-nest-playground
npx giget gh:middleapi/orpc/playgrounds/cloudflare-worker#1.x orpc-cloudflare-worker-playground
npx giget gh:middleapi/orpc/playgrounds/bun-websocket-otel#1.x orpc-bun-websocket-otel-playground
npx giget gh:middleapi/orpc/playgrounds/electron#1.x orpc-electron-playground
npx giget gh:middleapi/orpc/playgrounds/browser-extension#1.x orpc-browser-extension-playground
npx giget gh:middleapi/orpc-multiservice-monorepo-playground#1.x orpc-multiservice-monorepo-playground
```

For each project, set up the development environment:

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

That's it! You can now access the playground at `http://localhost:3000`.
