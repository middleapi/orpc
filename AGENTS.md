# AGENTS.md

## Repository

oRPC: typesafe APIs with RPC and OpenAPI support, in a pnpm monorepo.

- `packages/*`: the published packages; `packages/bun` runs with `bun test`, `packages/cloudflare` with its own vitest (workerd)
- `apps/content`: the docs site (Blume)
- `tests/`: e2e tests
- `playgrounds/*`: example apps
- `benches/`: benchmarks

## Commands

```bash
pnpm install
pnpm test                    # per-package tests + vitest
pnpm vitest run <path>       # one test file
pnpm check                   # lint and type check, including *.test-d.ts
pnpm fix                     # check, applying fixes
pnpm format                  # format with oxfmt
pnpm docs:validate           # JSDoc backlinks + docs links
pnpm bench
pnpm --filter @orpc/server prepack  # build one package; tests don't need a build
```

Before finishing, run `pnpm format`, `pnpm check` and `pnpm test`. CI doesn't check formatting.

## Pull requests

Titles follow Conventional Commits, scoped by the affected packages, separated by a comma and a space: `fix(server): ...`, `fix(server, client): ...`. Use `rpc`/`openapi` for changes tied to a protocol, and `content` only with `chore`, for the docs site itself; docs about a package use its scope (`docs(openapi): ...`). Leave out the scope when the change is too broad.
