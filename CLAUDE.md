# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

oRPC — typesafe API framework. pnpm monorepo (Node 22+, `pnpm` workspaces) with packages in `packages/*`, docs/website in `apps/content` (Blume), example apps in `playgrounds/*`, root-level e2e tests in `tests/`, and benchmarks in `benches/`.

## Commands

```bash
pnpm install                 # setup
pnpm test                    # all tests: per-package tests + root vitest
pnpm vitest run <path>       # single test file (from repo root), e.g. pnpm vitest run packages/server/src/builder.test.ts
pnpm type:check              # tsc across all packages — this is also what runs the *.test-d.ts type tests
pnpm lint                    # eslint (also the formatter — @antfu/eslint-config)
pnpm lint:fix
pnpm bench                   # vitest bench
pnpm --filter @orpc/server prepack # build one package (obuild, runs automatically on pack/publish); builds are NOT needed for dev/tests
```

- Root vitest config (`vitest.config.ts`) runs all `*.test.ts` with `globals: true`, plus a jsdom project for `*.test.tsx` in `packages/next`, `packages/tanstack-query`, `packages/pinia-colada` and `packages/swr`.
- Exceptions: `packages/bun` runs with `bun test`, `packages/cloudflare` with its own vitest (workerd) — both are excluded from the root vitest and root tsconfig. Run their tests via `pnpm --filter <pkg> test`. `packages/nest` is excluded only from the root tsconfig (type-check it with `pnpm --filter @orpc/nest type:check`); its tests run in the root vitest.
- Builds use obuild's transform mode (`build.config.ts` in each package): one `dist/*.mjs` + `.d.mts` per source file, so tree-shaking works without a bundler step. Declarations come from `isolatedDeclarations`, so exported values need explicit types where TS can't infer them from syntax alone. Mark side-effect-free module-level calls with `/* @__PURE__ */`. After building, `scripts/build-utils.ts` fails `prepack` if `dist` imports a package missing from `dependencies`/`peerDependencies`, has a relative import to a file that wasn't emitted or a runtime import cycle (move shared values into a leaf module), or if a `publishConfig.exports`/`sideEffects` path wasn't emitted.
- Docs site (Blume): `cd apps/content && pnpm dev` (`blume dev`); `pnpm build` runs `blume build`. Content lives in `.mdx` files; custom pages in `apps/content/pages/`. The dev server caches content-collection frontmatter for custom pages — restart it after editing blog-post frontmatter. `pnpm docs:validate` (root) runs the JSDoc backlink checker plus `blume validate --strict` (links, anchors, assets); CI runs it too.
- PR titles follow Conventional Commits. Scope rules:
  - Use the package name (e.g. `feat(server): ...`), or `rpc`/`openapi` for changes tied to a protocol rather than a single package, such as its serializers, handlers, links, or dedicated plugins.
  - Use `content` only for the docs site itself (styles, Blume config, ...), and only with the `chore` type — never `feat`/`fix`/`perf`/`docs`, since these changes do not affect library users. Documentation about a package or protocol uses that package/protocol scope instead (e.g. `docs(openapi): ...`).
  - Omit the scope when the change is too broad for a single one.
