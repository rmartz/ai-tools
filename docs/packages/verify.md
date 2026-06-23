---
type: Library
title: verify
description: Layer-1 verification — pre-push CI gate, tool-binary resolution, and CI infra-failure classification.
resource: packages/verify/src/index.ts
tags: [tooling, ci, pre-push, verification]
---

# @rmartz/verify

Layer-1 tooling: the local-verification half of the PR-efficiency loop. It
imports only `@rmartz/agent-runtime` (for `boundedRun` and `classifyCommand`) and
the `yaml` parser — nothing about PR Shepherd's gate/verdict labels. Library
first; the two CLIs are thin wrappers.

## Surface

### Tool resolution (`tool-resolver.ts`)

A **reframe**, not a port, of dotfiles' `python_env.py`. The Python resolved a
venv-first Python interpreter (≥3.10) because the pinned tools were Python
packages in a per-worktree `.venv`. This monorepo's tools (prettier, eslint, tsc,
vitest) are Node packages under `node_modules/.bin`, so the equivalent concern is
"which copy of the tool does the project actually run?" — the locally-installed
one, the same binary CI uses, not a stray global.

- `resolveTool(repoRoot, tool, opts?)` — argv prefix to run a project tool:
  `node_modules/.bin/<tool>` first, then a PATH lookup, then `pnpm exec <tool>`
  (only when a `pnpm` launcher is itself on PATH). `null` when nothing usable is
  found, so callers distinguish "unavailable" (a skip) from "failed" — mirroring
  the Python soft-fail.
- `localBin(repoRoot, tool, exists?)` / `onPath(tool, opts?)` — the individual
  resolution steps, exported for reuse. All fs/PATH boundaries are injectable.

### Pre-push gate (`pre-push-verify.ts`, `workflow-checks.ts`)

Runs the **locally-runnable subset of a project's CI checks** before a push.
Rather than guess commands, it reads the project's own `.github/workflows/*.yml`,
extracts every `run:` step, and re-runs the ones whose leading tool is a
locally-runnable check — so it executes the _actual_ commands CI runs (real
targets and flags), and a pass faithfully predicts those checks.

- `selectChecks(repoRoot, fs?)` — the deduplicated, category-ordered
  (format → lint → typecheck → test) `Check[]`, extracted from the workflows and
  classified by `@rmartz/agent-runtime`'s `classifyCommand`. Write-mode
  formatters (no `--check`), installs, deploys, and arbitrary shell are never
  selected.
- `verify(repoRoot, opts?)` — run every selected check and return its
  `CheckResult` (`pass` / `fail` / `skipped`). A check whose tool is unavailable
  locally is **skipped (a warning), not failed**, so a missing local tool never
  blocks the push. An empty result means no locally-runnable check was detected —
  a skip, not a failure.
- `anyFailed(results)` — the exit-1 condition. `detectRepoRoot(cwd)`,
  `runCheck`, `resolveArgv`, `tokenize` round out the surface. The filesystem,
  tool-resolution, and subprocess boundaries are all injectable for hermetic
  tests.

### Infra-failure classifier (`infra-failure.ts`)

Faithful port of dotfiles' `detect_ci_infra_failure.py`. Classifies a PR's CI
failure as a non-fixable **infrastructure** event (the jobs never ran — billing
lapse / runner outage) versus a fixable **code** failure, so a caller does not
spin up a noop fix PR.

- `isInfraFailure(repo, headSha, opts?)` → `{ isInfra, reason }`. Two infra
  signatures: a `startup_failure` run, or a `failure` run whose failing jobs
  executed zero steps. **Conservative**: any failing run with a real executed
  failing step makes the whole head fixable. On any `gh`/JSON error it soft-fails
  to fixable. The `gh` subprocess boundary is injectable (`opts.runner`).

## CLIs

Thin `bin/` wrappers; all logic stays in the library:

- `ai-pre-push-verify [-C PATH] [--list] [--json]` — exit 0 when every selected
  check passes or none is detected; exit 1 when any fails (its output is
  printed).
- `ai-detect-ci-infra-failure <pr> [--repo owner/name]` — resolves the PR head
  SHA via `gh`, prints `{ infra_failure, reason }` JSON. Always exits 0; callers
  branch on the field.

## Testing

All boundaries are mocked: tests `vi.mock('@rmartz/agent-runtime')` so no `gh` or
check subprocess ever runs, and feed workflow YAML / fs / PATH from in-memory
fixtures (deny-by-default, the spirit of dotfiles' `_hermetic.py`).
