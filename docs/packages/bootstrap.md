---
type: Library
title: bootstrap
description: Layer-1 repo bootstrapping — reconcile the canonical label roster and apply golden-state tooling-ignore files.
resource: packages/bootstrap/src/index.ts
tags: [tooling, bootstrap, labels, config, ignore-files]
---

# @rmartz/bootstrap

One-time (idempotent) repository setup, layer-1. It composes `@rmartz/github`
(label CRUD) and `@rmartz/agent-runtime` (`boundedRun`, for the bins' git
shell-out) and nothing else internal. It knows nothing about PR Shepherd's
gate/verdict labels — the roster here is the cross-cutting + meta set only.

## Surface

### Labels (`ensure-labels.ts`, `labels-roster.ts`)

- `ensureLabels(repo, { extra?, roster?, call? })` — idempotently reconcile a
  repo's labels with the roster: list current labels once, diff each spec, then
  **create / update / rename-in-place** to match. Color drift is compared
  case-insensitively ignoring a leading `#`; a casing-only name difference or a
  `renamedFrom` predecessor triggers a rename (preserving issue/PR
  associations) rather than a duplicate create. Throws only if the initial list
  fails (no live state to diff); per-label `gh` failures are collected into
  `result.failures` and reported per-label in `result.outcomes`, mirroring the
  Python's best-effort posture.
- `defaultRoster` = `crossCuttingLabels` + `metaLabels`. **Reframe from
  dotfiles' `labels.yml`:** only the cross-cutting domain labels carry over,
  plus `tracking` and `discussion` (the meta set). The dotfiles `workflow` set
  (PR-Shepherd gate/verdict labels) and per-app `projects` families are
  deliberately excluded — this layer must not know PR Shepherd's labels, and
  project families live with their projects. Colors are kept verbatim as 6-hex
  without a leading `#` (REST contract).

### Project config (`ensure-project-config.ts`, `golden-config.ts`)

- `ensureProjectConfig(root, { files? })` — pure-fs, no subprocess. Ensures each
  golden ignore file under `root` carries a single fenced **managed block**
  (`BLOCK_BEGIN`…`BLOCK_END`); it rewrites only that block and preserves any
  user-authored lines outside it ("ensure block present, don't clobber user
  content"). `root` is a parameter so tests target a tmpdir.
- `goldenIgnoreFiles` — **TS-toolchain reframe** of dotfiles'
  `ensure_project_config.py`. That script appended a single `.git-worktrees`
  entry and spliced an `eslint.config.js` ignores array via a comment-aware
  parser. Here the stack is pnpm + TS, so the golden ignores cover the TS
  build/test artifacts (`node_modules`, `dist`, `.turbo`, `*.tsbuildinfo`,
  `coverage`) plus `.git-worktrees/`, written to `.prettierignore`,
  `.eslintignore`, and `.gitignore`. The marker-block approach replaces the
  Python's fragile flat-config array splice entirely.

## CLIs

Thin `bin/` wrappers; all logic stays in the library:

- `ai-ensure-labels [owner/repo]` — reconcile the default roster on the given
  repo (or the current `gh` repo). Prints a per-label outcome summary; exits
  non-zero if any label failed.
- `ai-ensure-project-config` — detect the repo root (`git rev-parse
--show-toplevel`) and ensure the golden ignore blocks. Prints a per-file
  outcome summary.

## Testing

`ensure-labels` tests `vi.mock('@rmartz/github')` so no `gh` subprocess runs;
`ensure-project-config` tests mock `@rmartz/agent-runtime` to a hard failure
(proving the library never shells out) and write to a tmpdir with cleanup —
deny-by-default, no network.
