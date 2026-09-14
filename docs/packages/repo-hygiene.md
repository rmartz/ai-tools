---
type: Library
title: repo-hygiene
description: Layer-1 repo-quality gates — a pluggable check framework (registry, config, severity, reporter) shipping conflict-markers, md-pairing, and file-caps checks.
resource: packages/repo-hygiene/src/index.ts
tags: [tooling, quality-gates, ci, merge]
---

# @rmartz/repo-hygiene

Layer-1 tooling for repository hygiene gates. Library-first: every check is an
importable function behind one small framework; a thin `bin/` CLI wraps the
framework for the pre-commit hook and CI. Imports only `@rmartz/agent-runtime`
(for `boundedRun`) from layer 0, plus `yaml` for the config loader.

The package exists to end the per-repo duplication of the same hygiene checks
(OKF frontmatter, `CLAUDE.md`/`AGENTS.md` pairing, file-length caps, action-pin
enforcement): one tested implementation here, thin callers everywhere else. This
page documents the **framework** (the check contract, config, dispatch, output
contract) and the checks it ships: `conflict-markers` (the reference check),
`md-pairing`, and `file-caps`. Further checks land on top of this foundation
(epic #163).

## The check framework

A check is a small object implementing the `Check` contract:

```ts
interface Check {
  name: string; // its CLI id and its `.repo-hygiene.yml` key
  description: string;
  run(ctx: CheckContext): Promise<Finding[]>;
}
```

`run` receives a `CheckContext` — the resolved `FileSet` (paths + a mode-aware
content reader), the current `mode`, the check's own config section, and the
environment — and returns `Finding`s:

```ts
interface Finding {
  check: string;
  path?: string; // omitted for repo-level findings
  line?: number; // omitted for file-level findings
  message: string;
  severity: 'warn' | 'error';
}
```

### Discovery (`discovery.ts`)

Every check runs over one git-derived file set, selected by the mode. Resolving
the set (and its reader) **once** and sharing it across checks is what lets a
consumer run one job per check or a single aggregate job over identical inputs.
Tracked-only discovery gives ignore-handling for free.

| Mode           | Use                     | Scans                              |
| -------------- | ----------------------- | ---------------------------------- |
| `--staged`     | the `pre-commit` hook   | staged blobs (`git diff --cached`) |
| `--check`      | CI backstop             | all tracked files (`git ls-files`) |
| `--check-diff` | optional local pre-push | files changed vs `origin/main`     |

- `resolveFileSet(mode, { cwd? })` → `{ paths, read }`.
- File-list helpers `stagedFiles` / `trackedFiles` / `changedVsMain` (via
  `git … -z`, NUL-delimited) and content readers `stagedContent` (`git show`) /
  `worktreeContent` (`node:fs`).

### Registry + runner (`registry.ts`, `runner.ts`)

- `createRegistry(checks?)` builds the lookup from an explicit list (defaults to
  `builtinChecks()`); it is not a mutable global, so tests register fakes freely.
- `runHygiene(registry, req)` resolves the file set, runs the selected checks
  (`req.only`, or all when empty), applies each check's config severity override,
  and returns `{ findings, exitCode }`. **`exitCode` is `1` iff any finding is an
  `error`** — the enforced floor — otherwise `0`.

### Severity and the migration ramp

Findings carry an intrinsic `severity`. A repo can **override an entire check**
to `warn` (or `error`) from config — the runner applies it uniformly, so the ramp
works for every check without each re-implementing it. Setting a check to `warn`
reports its findings but keeps CI green while a repo works off a backlog; flip it
back to `error` once clean. This mirrors the ESLint-overrides threshold model.

### Config (`.repo-hygiene.yml`, `config.ts`)

Committed, validated. The framework knows only the envelope — a top-level mapping
with a `checks` map, each section optionally carrying `severity` — and passes
every other key through for the owning check (globs, thresholds, vocabularies,
exemptions):

```yaml
checks:
  conflict-markers:
    severity: error # optional; the ramp override
  file-caps:
    severity: warn
    max: 480 # check-specific — read by the check, opaque to the framework
```

A missing file is not an error (defaults apply); a present-but-malformed file
throws with a filename-prefixed message.

### Reporter (`reporter.ts`)

`formatFindings(findings)` renders the MVP's one output format — plain
`severity [check] path:line: message` lines — serving both the husky gate and CI
logs. Location collapses gracefully for file-level (no line) and repo-level (no
path) findings. Richer surfacing (`--format=github` annotations, SARIF) is
tracked as post-MVP follow-ups.

## Reference check: `conflict-markers`

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

### Surface

- `findConflictMarkers(text)` (`check-conflict-markers.ts`) — pure detector;
  returns sorted, 1-based `MarkerLine[]`, empty when no angle marker is present.
- `conflictMarkersCheck` (`checks/conflict-markers.ts`) — the framework adapter;
  maps `findConflictMarkers` output onto `Finding`s and preserves the bypass.
- `checkConflictMarkers(mode, { cwd?, env? })` and `formatReport(violations)` —
  the standalone entrypoint + report string behind the dedicated
  `ai-check-conflict-markers` CLI (unchanged).

### Bypass

For the rare case where a marker-like line must be committed intentionally:

- `git commit --no-verify` skips the hook (git-native), or
- set `ALLOW_CONFLICT_MARKERS=1`, which makes `--staged` pass. The bypass applies
  only in `--staged` mode — the CI backstop (`--check`) still catches markers.

## Check: `md-pairing`

`CLAUDE.md` / `AGENTS.md` must travel together: a directory that carries one must
carry the other, and each must be a **regular file**, never a symlink. A
symlinked directive file is detected by its git index mode (`120000`) and
flagged as a violation rather than followed — keeping both as real files means a
tool that reads only one of the two names sees the same content. Pairing is a
whole-tree invariant, so the check reads the full tracked set and its git modes
(via `trackedFileModes`) regardless of the run mode. `evaluatePairing(modes)` is
the pure evaluator; findings are file-level `error`s.

## Check: `file-caps`

Per-glob file size caps with a migration ramp. Config is an ordered `overrides`
list — **most-specific first, first-match-wins** (the first matching glob supplies
the whole `{ lines, bytes }` config for a file; no merge with later entries; an
unmatched file is uncapped):

```yaml
checks:
  file-caps:
    overrides:
      - glob: '**/AGENTS.md'
        lines: { warn: 200 } # warn on lines, no line error…
        bytes: { error: '40KB' } # …but a hard byte cap
      - glob: '**/*.test.ts'
        lines: { error: 720 } # tests: hard cap only
      - glob: '**/*'
        lines: { warn: 240, error: 480 } # catch-all, last
```

- **Two independent metrics.** `lines` (integer counts) and `bytes` (a raw
  integer or a human size string like `"40KB"` / `"1.5MB"`, binary units,
  normalized to bytes by `parseByteSize`). Each metric carries its own optional
  `warn` / `error` tier; a file can `warn` on one and `error` on the other in the
  same run.
- **Severity.** Over the `error` cap → `error`; over only the `warn` threshold →
  `warn`.

### Migration ramp (`.repo-hygiene-baseline.json`)

For repos adopting caps with existing over-limit files, a committed baseline
grandfathers them. On adoption, every file over its hard (`error`) cap is
recorded at its current size and reported as a `warn` instead of blocking.
Thereafter the baseline **only shrinks**, tracked **per metric**:

- a file that shrinks (but stays over cap) ratchets its ceiling down;
- a file that drops under the cap is removed;
- a file that grows past its recorded ceiling loses the grandfather and
  hard-errors;
- a brand-new file over cap is never auto-grandfathered — it errors.

Regenerate the baseline with `ai-repo-hygiene --update-baseline` (adoption when
no baseline file exists yet, a ratchet-down otherwise). Because each metric is
tracked separately, a file grandfathered on bytes still hard-errors if it later
crosses the line cap.

## CLIs

- `ai-repo-hygiene [<check>...] [--staged|--check|--check-diff] [--config <path>]`
  — the framework CLI. No check name runs every registered check (one aggregate
  status); naming one or more runs just those (independent per-check statuses).
  Mode defaults to `--staged`. Exit `0` when clean or warn-only, `1` on any error
  finding (report on stderr), `2` on a usage error or unknown check.
  - `--update-baseline` regenerates the file-caps grandfather baseline
    (`.repo-hygiene-baseline.json`) instead of running checks, then exits `0`.
- `ai-check-conflict-markers [mode] [-C <dir>]` — the original single-check wrapper,
  kept for its existing pre-commit-hook consumers; defaults to `--staged`.
  `-C`/`--cwd <dir>` runs the git scan in that directory, so a caller that cannot
  pin its cwd never needs `cd <dir> && ai-*`. Exit `0` when clean, `1` when markers
  are found (report on stderr), `2` on an unknown argument.

## Testing

The git boundary is mocked (`vi.mock('@rmartz/agent-runtime')`) so no subprocess
runs; worktree reads use fs fixtures in a tmpdir with cleanup. The framework is
tested with fake checks (registry lookup, per-check and all-checks dispatch, exit
codes, and the severity-override ramp in both directions); the config loader is
covered for valid, empty, and malformed shapes; conflict-marker detection is
covered as a pure function alongside the framework adapter and the env bypass.
`md-pairing` is covered through `evaluatePairing` (missing pair, symlink
violation, per-directory independence); `file-caps` covers the byte-size parser,
config validation, `computeMetrics`, `evaluateFileCaps` (first-match-wins,
independent metrics, warn/error tiers, and the grandfather downgrade / regrowth /
new-file cases), and the baseline build / ratchet-down / drop / never-add logic.
