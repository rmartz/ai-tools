# ai-tools

The general-purpose AI toolkit (TypeScript pnpm monorepo). Successor to
`rmartz/dotfiles` `claude/scripts/`. Cross-cutting agent knowledge and the
`discussion` issues live in `rmartz/ai`; tracking ledgers live in
`rmartz/ai-reports`.

## Package layers (hard rule, enforced by ESLint `boundaries`)

A package may only import from layers at or below its own:

- **layer-0 — foundation:** `@rmartz/agent-runtime`, `@rmartz/github`
- **layer-1 — tooling:** `@rmartz/worktree`, `@rmartz/verify`, `@rmartz/repo-hygiene`, `@rmartz/bootstrap`
- **layer-2 — composed:** `@rmartz/pr-review`, `@rmartz/reporting`, `@rmartz/issues`

PR Shepherd is a separate repo that imports these packages. **Nothing in ai-tools
may import PR Shepherd, and no package may know about PR Shepherd's gate/verdict
labels.** A new package is named for the **concept** it models, never for a
consumer — the dotfiles `foo-bar.py` → `foo_bar.py` mirror-naming smell is banned
here too.

## Dual interface

Every package is a library first. A CLI lives in `src/bin/<name>.ts` as a **thin
wrapper** that only parses args and prints — all logic stays in the importable
library so PR Shepherd and the harness share one implementation.

## File size

- Source/library files: split at ~240 lines; ESLint `max-lines` and the CI
  ratchet both hard-fail at **480**.
- Test files: hard-fail at **720**.
- The answer to a length failure is **extraction along a clean conceptual seam,
  never terseness/minification.** Move code out; do not compress what remains.

## Conventions

- Favor type inference; explicit type parameterization is a smell.
- Prettier + ESLint run in CI; there is no separate manual pass.
- Tests are hermetic: mock real-world boundaries (`gh`, network, subprocess).
  Deny-by-default — a test that reaches the network is a bug.
- **File naming is kebab-case everywhere** — source, tests, docs, and skill
  markdown (`pr-diff.ts`, `skill-dispatch.test.ts`, `agent-runtime.md`,
  `fix-review.md`). No `snake_case` and no `camelCase` filenames. The dotfiles
  Python split of `foo-bar.py` (CLI) vs `foo_bar.py` (module) does **not** carry
  over: a TS module and its CLI share one kebab-case stem (`pr-diff.ts` +
  `bin/pr-diff.ts`). The only non-kebab filenames allowed are conventional
  all-caps root meta files: `CLAUDE.md`, `README.md`, `LICENSE`.

## Docs

- One OKF page per package and non-trivial CLI under `docs/packages/`; skill
  pages live under `docs/skills/`. Update the page in the same PR as the code
  change. `scripts/check-okf-frontmatter.ts` walks `docs/**` and enforces valid
  frontmatter and a `resource` that points at a real file.

## Branch & PR workflow

Inherits the global worktree-per-task workflow from `~/.claude/CLAUDE.md`
(worktree under `.git-worktrees/`, pre-push verify, Conventional-Commit PR title,
sign with full model name).
