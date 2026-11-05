# AGENTS.md

## Repository

oRPC — typesafe API framework. pnpm monorepo (Node 22+, `pnpm` workspaces) with packages in `packages/*`, docs/website in `apps/content` (Blume), example apps in `playgrounds/*`, root-level e2e tests in `tests/`, and benchmarks in `benches/`.

## Commands

```bash
pnpm install                 # setup
pnpm test                    # all tests: per-package tests + root vitest
pnpm vitest run <path>       # single test file (from repo root), e.g. pnpm vitest run packages/server/src/builder.test.ts
pnpm check                   # oxlint with type-aware rules and type checking, including *.test-d.ts and playgrounds
pnpm fix                     # check, applying fixes
pnpm format                  # format with oxfmt
pnpm bench                   # vitest bench
pnpm --filter @orpc/server prepack # build one package with tsc; builds are NOT needed for dev/tests
```

Before finishing, run `pnpm format`, `pnpm check` and `pnpm test`. CI doesn't check formatting.

- Root vitest config (`vitest.config.ts`) runs all `*.test.ts` with `globals: true`, plus a jsdom project for `*.test.tsx` in `packages/next`, `packages/tanstack-query`, `packages/pinia-colada` and `packages/swr`.
- Exceptions: `packages/bun` runs with `bun test`, `packages/cloudflare` with its own vitest (workerd) — both are excluded from the root vitest and root tsconfig. Run their tests via `pnpm --filter <pkg> test`. `packages/nest` is excluded only from the root tsconfig; its tests run in the root vitest. These three packages type check with their own `tsconfig.json` and build with `tsconfig.build.json`.
- TypeScript uses `module: nodenext` and `verbatimModuleSyntax`: relative imports use explicit `.ts` extensions (rewritten to `.js` on build), and type-only imports use `import type`.
- Packages build with plain `tsc` (per-file `.js` + `.d.ts` in `dist`), extending `tsconfig.lib.json`. Exported values need explicit types (`isolatedDeclarations`, reported by `tsc` on build, not by `pnpm check`); mark side-effect-free module-level calls `/* @__PURE__ */`.
- Docs site (Blume): `cd apps/content && pnpm dev` (`blume dev`); `pnpm build` runs `blume build`. Content lives in `.mdx` files; custom pages in `apps/content/pages/`. The dev server caches content-collection frontmatter for custom pages — restart it after editing blog-post frontmatter. `pnpm docs:validate` (root) runs the JSDoc backlink checker plus `blume validate --strict` (links, anchors, assets); CI runs it too.
- PR titles follow Conventional Commits. Scope rules:
  - Use the package name (e.g. `feat(server): ...`), or `rpc`/`openapi` for changes tied to a protocol rather than a single package, such as its serializers, handlers, links, or dedicated plugins.
  - Use `content` only for the docs site itself (styles, Blume config, ...), and only with the `chore` type — never `feat`/`fix`/`perf`/`docs`, since these changes do not affect library users. Documentation about a package or protocol uses that package/protocol scope instead (e.g. `docs(openapi): ...`).
  - Omit the scope when the change is too broad for a single one.
