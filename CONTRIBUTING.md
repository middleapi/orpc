# Contributing to oRPC

Thank you for your interest in contributing to oRPC! We welcome all kinds of contributions: bug reports, feature requests, documentation improvements, and code enhancements.

If you need help or have questions, please join us on [Discord](https://discord.gg/TXEbwRBvQn).

> [!TIP]
> [Mini-oRPC](https://github.com/unnoq/mini-orpc) is a simplified implementation of oRPC that includes essential features to help you understand the core concepts. It's designed to be straightforward and easy to follow, making it an ideal starting point for learning about oRPC.

## Setup

This repository uses:

- **Node.js** v22+ (use [`pnpm env`](https://pnpm.io/cli/env) for quick setup)
- **pnpm** and **pnpm workspaces** for dependency management
- **Vitest** for testing
- **ESLint** with [@antfu/eslint-config](https://github.com/antfu/eslint-config) for linting and formatting

## Workflow

1. **Fork**: Fork the repository.
2. **Clone**: Clone your fork.
3. **Install**: Install dependencies.
   ```bash
   pnpm install
   ```
4. **Branch**: Create a new branch:
   ```bash
   git checkout -b feature/your-feature
   ```
5. **Code**: Make your changes.
6. **Test**: Manually verify in a playground, e.g.:
   ```bash
   cd playgrounds/next
   pnpm dev
   ```
7. **Tests**: Add or update tests:
   - Unit tests: add `.test-d.ts`, `.test.ts`, `.test.tsx` files next to code.
   - E2E tests: place in `/tests` under the relevant package.
8. **Commit & Push**:
   - Commit should follow the [Conventional Commits Cheatsheet](https://gist.github.com/Zekfad/f51cb06ac76e2457f11c80ed705c95a3) but not required because we usually use `Squash and Merge`.
9. **Pull Request**: Open a PR against `main` (or corresponding version branch).
   - our PR title should follow the [Conventional Commits Cheatsheet](https://gist.github.com/Zekfad/f51cb06ac76e2457f11c80ed705c95a3), with scope corresponding to the package.
   - In the description, summarize your changes and reference any related issue, e.g., `Fixes #123`.

## Structure

- **@orpc/shared** — shared utilities and types.
- **@orpc/client** — core library, ORPCError, RPC serializers, RPC link,...
- **@orpc/contract** — contract definitions (input/output/errors/meta/route, contract builder).
- **@orpc/server** — contract implementer, procedure/router builder, procedure/router client, RPC handler, ...
- **@orpc/openapi-client** - OpenAPI serializers, OpenAPI Link, ...
- **@orpc/openapi** — OpenAPI Spec generator, OpenAPI handler, ...
- **@orpc/standard-server\*** — environment adapters (`fetch`, `node`, etc.).
- **playgrounds/** — example applications.
- **apps/content/** - content, documentation, and website.
