---
type: Library
title: worktree
description: Layer-1 worktree tooling — create per-task worktrees, clean up closed-PR worktrees, and seed dispatched-worker permissions.
resource: packages/worktree/src/index.ts
tags: [tooling, worktree, issues, permissions, maintenance]
---

# @rmartz/worktree

Layer-1 tooling for the worktree-per-task workflow. It composes `@rmartz/github`
(layer-0) for issue assignment and PR-state lookups, and `@rmartz/agent-runtime`
(`boundedRun`) for every git/`gh` subprocess. Library-first: each CLI is a thin
`bin/` wrapper so PR Shepherd and the harness share one implementation.

## Surface

### Worktree creation (`new-worktree.ts`, `worktree-base.ts`)

- `runNewWorktree({ issue?, name?, branchPrefix?, base?, skipInstall?, cwd?, log? })`
  — create a worktree end-to-end and return `{ worktreePath, branch, baseRef,
defaultBranch }`. Fetches the base branch, `git worktree add`s under
  `<repo>/.git-worktrees/<branch-leaf>`, symlinks the shared Claude settings,
  optionally installs deps, and assigns the issue to the current `gh` user.
  Throws on a fatal step (not a git repo, repo-slug resolution, git fetch/add,
  dep install); issue assignment is non-fatal.
- `resolveDefaultBranch({ cwd?, log? })` — the repo's default branch via
  `gh repo view`, with a graceful local-git (`origin/HEAD`, then `git remote show
origin`) → `"main"` fallback so a GitHub API outage never aborts creation. The
  happy path never hard-codes `main`.
- `resolveBaseRef(base, { cwd? })` — turn `--base` into the origin branch to fork
  from: a branch name verbatim, or a PR reference (`#1271` / `1271`) resolved to
  its head branch via `gh pr view`. Enables **stacked** worktrees.
- Pure helpers: `deriveSlug`, `composeBranchName`, `composeWorktreeDir`,
  `detectInstallCommand`, plus the action primitives `createWorktree`,
  `symlinkClaudeSettings`, `installDeps`, `assignIssue`.

#### The venv → package-manager reframe

The dotfiles original built a per-worktree Python `.venv` and `pip install`ed
into it. This TS port has **no venv**: `detectInstallCommand` reads the JS
lockfile at the repo root and returns the matching package manager's install —
first match wins, because the lockfile dictates which manager is authoritative:

| Lockfile present    | Install command                  |
| ------------------- | -------------------------------- |
| `pnpm-lock.yaml`    | `pnpm install --frozen-lockfile` |
| `package-lock.json` | `npm ci`                         |
| `yarn.lock`         | `yarn install --frozen-lockfile` |
| `package.json` only | `npm install` (loose fallback)   |

A repo with no JS manifest installs nothing. The Python requirements/venv branch
and `python_env` interpreter discovery are dropped entirely.

### Cleanup (`git-cleanup.ts`)

- `runCleanup({ cwd?, log? })` — remove secondary worktrees and local branches
  whose PR is **closed/merged**, in three phases (worktrees → branches → `git
worktree prune`). Two states are deliberately preserved: an **open** PR (work
  in flight) and **no PR ever** (pre-PR WIP) — cleaning these up was the #1104
  data-loss bug. Never uses `--force`, and skips a closed-PR worktree that has
  uncommitted/untracked changes. Returns removed/kept counts.
- `classifyBranches(branches, repo, cwd, log)` — branch → `'open' | 'closed' |
'none'`. Open-PR head branches come from `gatherRepoStatus().openPrs`; the rest
  are classified via `gh pr list --head … --state all` + `fetchPrSummary` per PR.
  Any failure yields `'open'` — the conservative answer that never cleans up a
  branch it cannot confirm is abandoned.
- `parseSecondaryWorktrees(porcelain)` — parse `git worktree list --porcelain`
  into `(path, branch)` pairs, skipping the main and detached-HEAD entries.

### Worker permissions (`worker-permissions.ts`)

Library only — seeds the project-relative allowlist a coordinator-dispatched
headless worker needs so it never stalls on an unanswerable permission prompt
(#1192).

- `requiredWorkerPermissions(repoDir)` — the relative `Edit`/`Write(.git-
worktrees/**)` grants plus **absolute, repo-scoped** equivalents
  (`<repo>/.git-worktrees/**`) that match a worktree file by absolute path
  regardless of the worker's cwd (#1201), bounded to that repo's subtree.
- `effectiveAllow` / `missingWorkerPermissions` — read the union of
  `permissions.allow` across the repo's `.claude/settings*.json` (tolerant of
  missing/malformed files); a grant is covered by an exact match or a tool-wide
  grant (`Tool`, `Tool(*)`, `Tool(**)`).
- `ensureWorkerPermissions(repoDir)` — append only the missing grants to
  `.claude/settings.local.json`, preserving existing keys; a symlinked file is
  replaced with a concrete one rather than written through. Idempotent.

## CLIs

Thin `bin/` wrappers; all logic stays in the library:

- `ai-new-worktree <issue> [--name slug] [--branch-prefix fix|chore|…] [--base
branch|PR] [--skip-install]` — prints the worktree's absolute path as the final
  stdout line (progress logs go to stderr), so callers can chain into
  `cd "$(ai-new-worktree …)"`. The branch is unprefixed by default
  (`issue-<N>-<slug>` / `<name>`); `--branch-prefix` prepends a Conventional-Commit
  type.
- `ai-git-cleanup` — no arguments; run from within the repository.

`worker-permissions` is a library with no CLI.

## Testing

All boundaries are mocked: tests `vi.mock('@rmartz/agent-runtime')` and
`vi.mock('@rmartz/github')` so no real git/`gh` subprocess runs (deny-by-default).
Filesystem actions write to a tmpdir with cleanup. No network, no real waits.
