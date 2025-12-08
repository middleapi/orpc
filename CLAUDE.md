# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

oRPC is a TypeScript RPC + OpenAPI framework providing end-to-end type safety. It combines RPC simplicity with OpenAPI standards compliance.

Documentation: https://orpc.dev

## Common Commands

```bash
# Development
pnpm build                 # Build all packages
pnpm build:packages        # Build only packages (not playgrounds)
pnpm test                  # Run all tests
pnpm test:watch            # Run tests in watch mode
pnpm test -- packages/server  # Run tests for specific package

# Code Quality
pnpm lint                  # ESLint (zero warnings enforced)
pnpm lint:fix              # Auto-fix lint issues
pnpm type:check            # TypeScript type checking
pnpm sherif                # Check dependency consistency
pnpm knip                  # Detect dead code

# Publishing
pnpm packages:bump         # Bump versions
pnpm packages:publish      # Build and publish to npm
```

## Architecture

### Monorepo Structure

- **packages/** - 35 npm packages (`@orpc/*`)
- **playgrounds/** - Example projects (Next.js, Nuxt, Svelte-Kit, NestJS, Cloudflare, etc.)

### Core Packages

```
@orpc/shared     → Foundation utilities
     ↓
@orpc/contract   → API contract definitions (schema-agnostic)
     ↓
@orpc/server     → Server implementation with adapters
     ↓
@orpc/client     → Type-safe client generation
     ↓
@orpc/openapi    → OpenAPI spec generation
```

### Server Adapters

Import from `@orpc/server/<adapter>`:
- `node` - Node.js HTTP
- `fetch` - Fetch API (Cloudflare, Deno, Bun)
- `fastify` - Fastify framework
- `aws-lambda` - AWS Lambda
- `websocket`, `ws`, `crossws`, `bun-ws` - WebSocket variants
- `message-port` - MessagePort (browser extensions, workers)

### Schema Integrations

- `@orpc/zod` - Zod support with OpenAPI generation
- `@orpc/valibot` - Valibot OpenAPI generation
- `@orpc/arktype` - ArkType OpenAPI generation

### UI Framework Integrations

- `@orpc/react` - React utilities and Server Actions
- `@orpc/tanstack-query` - TanStack Query (React, Vue, Solid, Svelte, Angular)
- `@orpc/vue-colada` - Pinia Colada
- `@orpc/react-swr` - SWR (experimental)

## Key Patterns

### Builder Pattern

```typescript
import { os } from '@orpc/server'

const procedure = os
  .input(schema)
  .use(middleware)
  .$context<ContextType>()
  .handler(async ({ input, context }) => result)
```

### Middleware

Middleware transforms context and chains via `next()`:

```typescript
.use(({ context, next }) => {
  return next({ context: { ...context, user } })
})
```

### Plugins

Available in `@orpc/server/plugins`:
- `CORSPlugin` - CORS handling
- `BatchPlugin` - Request batching
- `SimpleCSRFProtectionPlugin` - CSRF protection
- `StrictGetMethodPlugin` - GET method enforcement

## Build System

- **unbuild** - Package builds
- **TypeScript** - ES2022 target, strict mode, bundler resolution
- **Vitest** - Testing with multiple environments (Node, jsdom, Solid, Svelte)

### Package Export Pattern

Development exports point to `./src/*.ts`, published exports to `./dist/*.mjs`:

```json
{
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "import": "./dist/index.mjs" } }
  }
}
```

## Testing

```bash
pnpm test                              # All tests
pnpm test -- packages/server           # Specific package
pnpm test:coverage                     # With coverage
pnpm test:ui                           # Vitest UI
```

Test files: `*.test.ts`, `*.test.tsx`
Type tests: `*.test-d.ts`

Vitest projects:
1. Node.js environment (`.test.ts`)
2. jsdom (React, Vue, TanStack Query)
3. jsdom + Solid plugin
4. jsdom + Svelte plugin

## Conventions

- Pure ES modules (no CJS)
- Workspace protocol for internal deps: `workspace:*`
- Zero ESLint warnings enforced
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Pre-commit hooks via simple-git-hooks + lint-staged
