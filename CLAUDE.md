# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

oRPC — typesafe API framework. pnpm monorepo (Node 22+, `pnpm` workspaces) with packages in `packages/*`, docs/website in `apps/content` (Blume), example apps in `playgrounds/*`, root-level e2e tests in `tests/`, and benchmarks in `benches/`.

## Commands

```bash
pnpm install                 # setup
pnpm test                    # all tests: per-package tests + root vitest
pnpm vitest run <path>       # single test file (from repo root), e.g. pnpm vitest run packages/server/src/builder.test.ts
pnpm check                   # oxlint: lint + type-aware rules + type check (this is what runs the *.test-d.ts type tests)
pnpm fix                     # oxlint --fix
pnpm format                  # oxfmt (not checked in CI)
pnpm bench                   # vitest bench
pnpm --filter @orpc/server prepack # build one package (tsc, runs automatically on pack/publish); builds are NOT needed for dev/tests
```

- Root vitest config (`vitest.config.ts`) runs all `*.test.ts` with `globals: true`, plus a jsdom project for `*.test.tsx` in `packages/next`, `packages/tanstack-query`, `packages/pinia-colada` and `packages/swr`.
- Exceptions: `packages/bun` runs with `bun test`, `packages/cloudflare` with its own vitest (workerd) — both are excluded from the root vitest. Run their tests via `pnpm --filter <pkg> test`. `packages/nest` tests run in the root vitest.
- TypeScript: one root `tsconfig.json` (tests, scripts, benches) plus `tsconfig.lib.json`, which every package `tsconfig.json` extends for its build (`src` → `dist`); no project references. `bun`, `cloudflare` and `nest` need other types or decorators for their tests, so their `tsconfig.json` covers `src` + tests and `tsconfig.build.json` is the build. oxlint type-checks every file against the nearest `tsconfig.json`.
- Imports: `module: nodenext` with `verbatimModuleSyntax`; relative imports use explicit `.ts`/`.tsx` extensions (rewritten to `.js` on build), JSON imports need `with { type: 'json' }`, and deep imports into packages without an `exports` map need `.js` (e.g. `next/navigation.js`).
- Builds are plain `tsc` (per-file `.js` + `.d.ts` in `dist`) with TypeScript 7, followed by `scripts/verify-dist.ts`, which fails `prepack` on undeclared imports, import cycles and missing `exports`/`sideEffects` targets. Mark side-effect-free module-level calls `/* @__PURE__ */`. `apps/content` and the playgrounds stay on TypeScript 6 because their tooling (Blume's twoslash, Astro, Next.js, Nest CLI) needs the TypeScript JS API.
- Docs site (Blume): `cd apps/content && pnpm dev` (`blume dev`); `pnpm build` runs `blume build`. Content lives in `.mdx` files; custom pages in `apps/content/pages/`. The dev server caches content-collection frontmatter for custom pages — restart it after editing blog-post frontmatter. `pnpm docs:validate` (root) runs the JSDoc backlink checker (`apps/content/scripts/verify-docs-jsdoc.ts`) plus `blume validate --strict` (links, anchors, assets); CI runs it too.
- PR titles follow Conventional Commits. Scope rules:
  - Use the package name (e.g. `feat(server): ...`), or `rpc`/`openapi` for changes tied to a protocol rather than a single package, such as its serializers, handlers, links, or dedicated plugins.
  - Use `content` only for the docs site itself (styles, Blume config, ...), and only with the `chore` type — never `feat`/`fix`/`perf`/`docs`, since these changes do not affect library users. Documentation about a package or protocol uses that package/protocol scope instead (e.g. `docs(openapi): ...`).
  - Omit the scope when the change is too broad for a single one.
