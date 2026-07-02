# ai-tools

The general-purpose AI toolkit (TypeScript pnpm monorepo). Successor to
`rmartz/dotfiles` `claude/scripts/`. Cross-cutting agent knowledge and the
`discussion` issues live in `rmartz/ai`; tracking ledgers live in
`rmartz/ai-reports`.

## Commands

- `pnpm build` — Turborepo build of every package into `dist/`. Run before tests;
  they import sibling packages through their `exports` → `dist/`.
- `pnpm test` (`pnpm test:watch`) — Vitest.
- `pnpm typecheck` / `pnpm lint` / `pnpm format` (`format:check`) — Turbo
  typecheck / ESLint / Prettier.
- `pnpm run ci` — the full local gate (typecheck, lint, format, repo-hygiene
  checks, tests). Run before pushing, or use `~/.claude/scripts/pre-push-verify.py`.
- `pnpm install:skills` — symlink the skills in `skills/` into `~/.claude`.
- `pnpm install:clis` — install/update the published `ai-*` CLIs globally from
  GitHub Packages (`pnpm add -g @rmartz/*@latest`); needs `read:packages` auth.
  Re-run to update; a SessionStart hook can automate it (see `docs/install-clis.md`).

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
- **Pin every dependency to a full `[major].[minor].[patch]` version** in each
  `package.json`. Keep the range operator (`^` / `~`) — pin the _base_, e.g.
  `^3.8.3`, never an abbreviated `^3` or `^3.8`. A bare-major (or major-minor) pin
  lets Dependabot upgrade the dependency through a `pnpm-lock.yaml`-only change
  with **no `package.json` diff**, hiding the bump from review — the canonical
  failure is a minor `prettier` bump that silently reformats the tree and only
  surfaces as a red CI run. The full base makes every upgrade an explicit,
  reviewable `package.json` change. (CI enforcement is tracked in #63.)
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
- **Strict TypeScript throughout — no `any`, no `@ts-ignore`.** The strict flags
  (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` in
  `tsconfig.base.json`) are load-bearing; reach for a precise type, a narrowing
  guard, or `unknown` rather than escaping the type system.
- **Value sets: prefer a structural string union over an `enum`.** Use
  `type MergeMethod = 'merge' | 'squash' | 'rebase'`; when you also need the values
  at runtime (validation, iteration), use an `as const` array and derive the type
  — `const MERGE_METHODS = [...] as const; type MergeMethod = (typeof MERGE_METHODS)[number]`.
  Both stay structural, so raw literals and `gh`/API strings assign without a cast,
  and they emit ~no runtime. Reserve `enum` for internal state you iterate as a unit
  and never serialize raw: string enums are **nominal** (won't accept the underlying
  literal, forcing a cast at every wire boundary), and `const enum` is unavailable
  under `isolatedModules`, so a plain `enum` always ships a runtime object.
- Prefer `async`/`await` over `.then()` chains.
- **Named exports only — no default exports.** Each package's public surface is
  its `index.ts` barrel; `bin/` entrypoints run a `main()` and export nothing.
- No spurious variables — don't bind a value only to return it on the next line;
  return the expression. No IIFEs — extract a named helper or compute the value
  with a plain expression.

## Testing

- Vitest with `describe` / `it` (not `test`). Tests are hermetic (see Conventions).
- Fixture generators are named `make{Domain}()` (e.g. `makePr()`, `makeReview()`).
- **Test design:**
  - **Control inputs and outputs.** Don't assert a function's _default_ return as
    the outcome unless the test exists to verify that default — pass explicit,
    non-default values so a pass proves logic ran, not an initializer.
  - **One reason to fail per test.** Assert a single logical outcome; if a test
    exercises two functions it should be testing their interaction, not taking
    incidental coverage of the second.
  - **Keep tests simple.** A failure should make it obvious whether it is a bug or
    an intended behavior change; if telling them apart needs more than one layer of
    setup or several assertions, split the test.
  - **Granularity scales with abstraction.** Pure utilities and serializers get
    thorough edge-case coverage; orchestration gets smoke tests that confirm the
    lower-level logic is wired up, not a re-test of every edge case.

## Docs

- Keep docs in sync with the code — outdated docs are worse than no docs.
- One OKF page per package and non-trivial CLI under `docs/packages/`; skill
  pages live under `docs/skills/`. Update the page in the same PR as the code
  change. `scripts/check-okf-frontmatter.ts` walks `docs/**` and enforces valid
  frontmatter and a `resource` that points at a real file.

## Branch & PR workflow

Inherits the global worktree-per-task workflow from `~/.claude/CLAUDE.md`
(worktree under `.git-worktrees/`, pre-push verify, Conventional-Commit PR title,
sign with full model name).
