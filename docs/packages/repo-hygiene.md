---
type: Library
title: repo-hygiene
description: Layer-1 repo-quality gates — currently the merge-conflict-marker checker (pre-commit hook + CI backstop).
resource: packages/repo-hygiene/src/index.ts
tags: [tooling, quality-gates, ci, merge]
---

# @rmartz/repo-hygiene

Layer-1 tooling for repository hygiene gates. Library-first: every check is an
importable function; a thin `bin/` CLI wraps it for the pre-commit hook and CI.
Imports only `@rmartz/agent-runtime` (for `boundedRun`) from layer 0.

For now this package ships a single check, `check-conflict-markers`. The other
dotfiles hygiene checks are intentionally out of scope: file-length is enforced by
ESLint's `max-lines` rule (no separate script), the OKF frontmatter check lives in
the repo's root `scripts/` (`check-okf-frontmatter.ts`), and `check_exec_bits` is
obsolete — TS bins declare their executables via `package.json` `bin` maps rather
than filesystem exec bits.

## check-conflict-markers

Block commits that introduce merge-conflict markers. A botched conflict
resolution can leave markers in a file; before this guard nothing stopped them
being committed and pushed, so they were only caught at review time. This is the
commit-time guard plus a CI backstop. TS port of dotfiles'
`check_conflict_markers.py`.

### Detection (full-triple, no doc special-casing)

A file is flagged **only** when it contains an unambiguous conflict **angle**
marker — a line beginning with seven `<` or seven `>` (`<<<<<<< HEAD`,
`>>>>>>> branch`). These never occur in normal source or Markdown, so they are
enforced everywhere. The separator line (seven `=`) and the diff3 base line
(seven `|`) are reported too, but **only** in a file that already has an angle
marker. That "full-triple" rule avoids the false positive a lone Markdown setext
underline or `=======` divider would otherwise cause — without special-casing
`*.md` / `docs/` paths.

### Surface (`check-conflict-markers.ts`)

- `findConflictMarkers(text)` — pure detector; returns sorted, 1-based
  `MarkerLine[]` (`{ lineno, line }`), empty when no angle marker is present.
- `checkConflictMarkers(mode, { cwd?, env? })` — resolve the path list for a mode
  and scan it, returning `Violation[]` (`{ path, lineno, line }`). In `--staged`
  mode the `ALLOW_CONFLICT_MARKERS` env var short-circuits to an empty result.
- `scan(paths, read)` — scan an explicit path list with an injectable
  (sync-or-async) `ContentReader`.
- File-list helpers `stagedFiles` / `trackedFiles` / `changedVsMain` (via
  `git … -z`, NUL-delimited) and content readers `stagedContent` (`git show`) /
  `worktreeContent` (`node:fs`).
- `formatReport(violations)` — the stderr report string (`path:line: line` plus
  the bypass hint).

### Modes

| Mode           | Use                     | Scans                              |
| -------------- | ----------------------- | ---------------------------------- |
| `--staged`     | the `pre-commit` hook   | staged blobs (`git diff --cached`) |
| `--check`      | CI backstop             | all tracked files (`git ls-files`) |
| `--check-diff` | optional local pre-push | files changed vs `origin/main`     |

### Bypass

For the rare case where a marker-like line must be committed intentionally:

- `git commit --no-verify` skips the hook (git-native), or
- set `ALLOW_CONFLICT_MARKERS=1`, which makes `--staged` pass.

## CLI

`ai-check-conflict-markers [mode]` — thin `bin/` wrapper; defaults to `--staged`.
Exit `0` when clean, `1` when markers are found (report on stderr), `2` on an
unknown mode.

## Testing

The git boundary is mocked (`vi.mock('@rmartz/agent-runtime')`) so no subprocess
runs; worktree reads use fs fixtures in a tmpdir with cleanup. Detection is
covered as a pure function — full triple, clean code, lone separator / setext
underline not flagged, angle-only, diff3 base — alongside the mode wiring and the
env bypass.
