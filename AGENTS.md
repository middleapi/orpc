# AGENTS.MD

## Agent Protocol
- Keep files <~500 LOC; split/refactor as needed.
- Commits: Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`).
- Prefer end-to-end verify; if blocked, say what's missing.
- Web: search early; quote exact errors.

## Important Locations
- App: `./app`
- Server: `./server`
- Database schema and seed: `./server/db`
- Public assets: `./public`

## Docs
- Keep notes short; update docs when behavior/API changes.
- Add `read_when` hints on cross-cutting docs when docs are added.

## Flow & Runtime
- Use repo's package manager/runtime; no swaps without approval.
- This repo uses Nuxt 4, oRPC, Nuxt UI, Drizzle ORM, Better Auth, Postgres, and `pnpm`.

## Verification
- Use chrome_devtools MCP to verify UI changes when practical. Use screenshots and console logs; avoid clicking around unless instructed.
- Use the worktree's `NUXT_PORT` from `.env` for local verification URLs. If `NUXT_PORT` is not set, fall back to `3000`.
- **Before starting the dev server, always check if the current worktree port is already in use:**
  ```bash
  # Example for a worktree configured with NUXT_PORT=3001
  lsof -ti:3001
  # If it returns a PID, the server for that worktree is already running, don't start it again
  # If it returns nothing, it's safe to start the server with: pnpm dev --port 3001
  ```
- Initial setup before verification:
  1. Read the worktree port from `.env` (`NUXT_PORT`, default `3000`) and check whether that port is already in use.
  2. If the server is not running, start it with `pnpm dev --port <worktree-port>`.
  3. Run chrome_devtools MCP to start/connect Chrome when browser verification is needed.
  4. Navigate to the target page on the worktree port.
  5. Verify the page loaded by taking a screenshot.
- Use the repo's scripts before handing work back:
  - `pnpm typecheck` for TypeScript and Nuxt validation.
  - `pnpm build` when changes affect runtime, routing, server code, or deployment behavior.
- Important pages in the system:
  - Home page: `http://localhost:<worktree-port>/`
  - API reference page: `http://localhost:<worktree-port>/api`
  - Login page: `http://localhost:<worktree-port>/login`
  - Signup page: `http://localhost:<worktree-port>/signup`
  - Dashboard page: `http://localhost:<worktree-port>/dashboard`
  - Planets page: `http://localhost:<worktree-port>/dashboard/planets`
  - Stream page: `http://localhost:<worktree-port>/dashboard/stream`
  - Pricing page: `http://localhost:<worktree-port>/pricing`
- Verification login:
  - Run `pnpm db:seed` first if the local database is empty.
  - Use the seeded account `john@doe.com` with password `123456`.

## Git
- Safe by default: `git status/diff/log`. Push only when user asks.
- **DO NOT COMMIT unless explicitly asked by user** - commits should only be made when user specifically requests it.
- Don't delete/rename unexpected stuff; stop and ask.
- No repo-wide S/R scripts; keep edits small/reviewable.
- Avoid manual `git stash`; if Git auto-stashes during pull/rebase, that's fine.
- If user types a command ("pull and push"), that's consent for that command.
- No amend unless asked.
- Delete unused or obsolete files when your changes make them irrelevant, and revert files only when the change is yours or explicitly requested.
- Before attempting to delete a file to resolve a local type/lint failure, stop and ask the user.
- Moving/renaming and restoring files is allowed.
- ABSOLUTELY NEVER run destructive git operations (e.g., git reset --hard, rm, git checkout/git restore to an older commit) unless the user gives an explicit, written instruction in this conversation.
- Never use git restore (or similar commands) to revert files you didn't author; coordinate instead so in-progress work stays intact.
- Always double-check git status before any commit.
- Keep commits atomic: commit only the files you touched and list each path explicitly. For tracked files run `git commit -m "<scoped message>" -- path/to/file1 path/to/file2`. For brand-new files, use the one-liner `git restore --staged :/ && git add "path/to/file1" "path/to/file2" && git commit -m "<scoped message>" -- path/to/file1 path/to/file2`.
- Quote any git paths containing brackets or parentheses (e.g., `src/app/[candidate]/**`) when staging or committing so the shell does not treat them as globs or subshells.
- When running git rebase, avoid opening editors; export `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:` or pass `--no-edit` so the default messages are used automatically.
- Never amend commits unless you have explicit written approval in the task thread.

## Git Worktrees
- Use `pnpm worktree:up` to bootstrap a worktree end-to-end. It installs dependencies if needed, creates or updates `.env`, assigns a worktree-specific `NUXT_PORT`, points `DATABASE_URL` at a worktree-specific local database, starts Postgres, pushes the schema, seeds the database, and starts the app unless it is already running on that port.
- After creating or switching to a worktree, run `pnpm install` in that worktree before doing anything else.
- Make sure the worktree has its own `.env`. Start from another worktree's `.env` or `.env.example`, then update it for the worktree.
- Set a unique `NUXT_PORT` in the worktree `.env` so multiple worktrees can run side-by-side without fighting over the same dev port.
- Change `DATABASE_URL` in the worktree `.env` to point at an isolated database for that worktree. Do not reuse another worktree's local database.
- If the isolated database is new or empty, run `pnpm db:push` and `pnpm db:seed` before starting the app.

## Critical Thinking
- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask with short options.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume another agent; keep going and focus your changes. If it causes issues, stop and ask user.
- Leave breadcrumb notes in thread.

## Tools

### gh
- GitHub CLI for GitHub operations.

## Frontend
- Nuxt UI is the main UI component library.
