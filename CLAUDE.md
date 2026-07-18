# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

oRPC — typesafe API framework. pnpm monorepo (Node 22+, `pnpm` workspaces) with packages in `packages/*`, docs/website in `apps/content` (VitePress), example apps in `playgrounds/*`, root-level e2e tests in `tests/`, and benchmarks in `benches/`.

## Commands

```bash
pnpm install                 # setup
pnpm test                    # all tests: per-package tests + root vitest
pnpm vitest run <path>       # single test file (from repo root), e.g. pnpm vitest run packages/server/src/builder.test.ts
pnpm type:check              # tsc across all packages — this is also what runs the *.test-d.ts type tests
pnpm lint                    # eslint (also the formatter — @antfu/eslint-config)
pnpm lint:fix
pnpm bench                   # vitest bench
pnpm --filter @orpc/server build   # build one package (unbuild); builds are NOT needed for dev/tests
```

- Root vitest config (`vitest.config.ts`) runs all `*.test.ts` with `globals: true`, plus a jsdom project for `*.test.tsx` in `packages/next` and `packages/tanstack-query`.
- Exceptions: `packages/bun` runs with `bun test`, `packages/cloudflare` with its own vitest (workerd) — both are excluded from the root vitest and root tsconfig, as is `packages/nest`. Run their tests via `pnpm --filter <pkg> test`.
- Docs site: `cd apps/content && pnpm dev`.
- PR titles follow Conventional Commits with the package as scope (e.g. `feat(server): ...`).
