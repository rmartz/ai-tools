---
type: Library
title: reporting
description: Layer-2 composed reporting — tracking-issue ledgers, transcript friction extraction, anomaly filing, and PR efficiency auditing.
resource: packages/reporting/src/index.ts
tags: [composed, reporting, tracking, friction, anomaly, efficiency, transcripts]
---

# @rmartz/reporting

Layer-2 composed package for **reporting** recurring agent observations. It
composes the layer-0 `@rmartz/github` issue ops and `@rmartz/agent-runtime`
transcript reader; nothing here knows about PR Shepherd's gate/verdict labels.

It ships four concerns — **tracking**, **friction**, **anomaly**, and
**efficiency-audit**. The latter two implement the agreed cross-repo contract in
[`docs/reporting-schema.md`](../reporting-schema.md) (confirmed with PR Shepherd
2026-06-23): ai-tools owns the category→ledger-title mapping and derives
efficiency counts standalone, while PR Shepherd emits occurrences / optionally
enriches `durationsMs` through this package's seams.

## Tracking ledgers (`tracking.ts`)

A tracking ledger is a long-lived GitHub issue that aggregates recurring
occurrences of one pattern into a single issue — one comment per occurrence —
rather than filing a new issue each time. `reportToTracking` owns the entire
**find-or-create-or-append** process:

1. Resolve the source repo (`sourceRepo`, else `currentRepo()`) and coordinator
   sha (`coordinatorSha`, else `coordinatorGitSha()`).
2. Prepend the standardized metadata header (below) to the body.
3. Find an open issue with the exact title and the `tracking` label.
4. **If found**, append the body as a comment; **if not**, create the issue with
   the body and the `tracking` label (first occurrence becomes the ledger).

Callers never pre-create or recreate the ledger: once a fix PR closes one, the
next occurrence recreates it lazily by title. All ops **soft-fail to `null`**,
matching the underlying `@rmartz/github` posture.

### Target repo

Ledgers default to the central **`rmartz/ai-reports`** repo
(`DEFAULT_TRACKING_REPO`), overridable per call via `repo`. A ledger usually
lives in this central repo while occurrences arrive from many app repos, so the
header's **Repository** line keeps each occurrence's origin unambiguous. (This
supersedes the retired "self-report into PR Shepherd's own issues" pattern.)

### Standardized occurrence header

`formatOccurrence(body, meta)` prepends one line per available field, in this
order — each omitted when its value is absent, returning the body unchanged when
no metadata exists:

| Field            | Header line                      | Source                       |
| ---------------- | -------------------------------- | ---------------------------- |
| `sourceRepo`     | `**Repository:** \`owner/repo\`` | `sourceRepo` / `currentRepo` |
| `coordinatorSha` | `**Coordinator:** \`sha\``       | `coordinatorSha` / git HEAD  |
| `skill`          | `**Skill:** \`/name\``           | `skill`                      |
| `pr`             | `**PR:** owner/repo#N` (or `#N`) | `pr`                         |
| `transcriptId`   | `**Transcript:** \`id\``         | `transcriptId`               |
| `skillMeta`      | `**Skill metadata:** \`marker\`` | `skillMeta`                  |

### API

- `reportToTracking(title, body, opts?) => Promise<string | null>` — the ledger
  URL, or `null` on failure. `opts`: `repo`, `label`, `extraLabels`, `cwd`,
  `call`, plus all `OccurrenceMeta` fields.
- `formatOccurrence(body, meta?) => string`
- `coordinatorGitSha(cwd?) => Promise<string | null>` — short HEAD sha, cached
  for the process lifetime; best-effort.
- `DEFAULT_TRACKING_REPO`, `TRACKING_LABEL` constants.

### CLI — `ai-report-to-tracking`

```
ai-report-to-tracking <title> <body-file> [--repo <owner/repo>] \
  [--source-repo <owner/repo>] [--skill <name>] [--pr <n>] \
  [--transcript <id>] [--meta <text>] [--delete-body]
```

`--repo` is the **ledger** repo (defaults to `rmartz/ai-reports`); `--source-repo`
is the repo the occurrence is about. `--delete-body` removes the body file, but
only after a successful post. Prints the ledger URL on success.

## Friction extraction (`friction.ts`)

Scans Claude Code transcript events for five friction signals and renders a
Markdown report. The JSONL reader is **not** re-implemented: the library parses
transcript text via `@rmartz/agent-runtime`'s `parseLogEventsText`, so it carries
no `~/.claude` directory-walking knowledge and tests stay hermetic (in-memory
strings).

Signals detected:

- **Tool Errors** — `tool_result` blocks with `is_error: true`.
- **User Corrections** — short user text matching correction keywords.
- **Hook Blocks** — user-role hook feedback matching blocked/denied patterns.
- **Tool Retries** — the same tool re-invoked in a later assistant turn.
- **Context Compactions** — `summarized`/`compact` events or context-limit
  mentions in system/assistant text.

### API

- `extractFrictionEvents(events, fallbackLabel?) => FrictionEvent[]`
- `extractFrictionFromText(text, fallbackLabel?) => FrictionEvent[]`
- `formatFrictionReport(results, days?) => string` — `days` only labels the
  heading; transcript discovery/windowing is the caller's job.

### CLI — `ai-extract-friction`

```
ai-extract-friction [--days N] <transcript.jsonl> [<transcript.jsonl> ...]
```

Takes explicit transcript paths (discovery is the caller's responsibility) and
prints the report. `--days N` labels the heading only.

## Anomaly reporting (`anomaly.ts`)

The ai-tools-owned bridge from an `AnomalyOccurrence` (emitted by PR Shepherd's
`IssueFiler` adapter or by the harness for flaky tests / failed local
validation) to a tracking ledger in `rmartz/ai-reports`. ai-tools is the
**single authority** for the category(+subject)→ledger-title mapping, so every
emitter dedups onto identical ledgers. The wire contract — the `AnomalyCategory`
slugs, the stable titles, and the `AnomalyOccurrence` field names — is fixed by
[`docs/reporting-schema.md`](../reporting-schema.md).

`AnomalyCategory` is a **closed enum** of 13 kebab-case slugs (the schema table).
`premature-exit` is **retired** — it surfaces via `timeout-then-fast-retry` /
`high-retry-rate` and is not a category; an unknown slug soft-fails to `null`
rather than throwing at the seam.

`reportAnomaly`:

1. Maps `category` (+ optional kebab-case `subject`) → the stable ledger title
   via `ledgerTitle`. A subject is appended as a `: <subject>` suffix so a
   refined occurrence (e.g. `fix-review-loop` for `/review`) routes to its own
   ledger while keeping the shared category dedup key.
2. Projects the occurrence's correlation fields onto the standardized
   occurrence header (`sourceRepo`, `gitHash` → coordinator sha, `pr`,
   `transcriptId`), with the remaining specifics (run id, step instance, head
   SHA, skill version, and structured `evidence`) rendered into the body.
3. Calls `reportToTracking` (find-or-create-or-append) into `rmartz/ai-reports`
   by default.

### API

- `reportAnomaly(occ, opts?) => Promise<string | null>` — ledger URL, or `null`
  on soft-fail (including the defensive unknown-category path). `opts`: `repo`
  (ledger repo, defaults to `rmartz/ai-reports`), `cwd`.
- `ledgerTitle(category, subject?) => string | null` — the stable title, or
  `null` for an unknown category.
- `AnomalyCategory`, `AnomalyOccurrence`, `ReportAnomalyOptions` types.

### CLI — `ai-report-anomaly`

```
ai-report-anomaly --category <slug> --summary <text> --source-repo <owner/repo> \
  --timestamp <iso> [--subject <s>] [--detail <text>] [--pr <n>] \
  [--git-hash <sha>] [--head-sha <sha>] [--run-id <id>] [--step-instance-id <id>] \
  [--skill-version <v>] [--transcript <id>] [--repo <ledger owner/repo>]
```

For non-TS emitters. Prints the ledger URL on success; exits non-zero on an
unknown category or filing failure.

## PR efficiency audit (`efficiency-audit.ts` + `efficiency-derive.ts`)

Derives an `EfficiencyEvent` for a PR **standalone** from GitHub history — a
cross-repo, all-PRs profiler. ai-tools owns the count detectors; PR Shepherd
never emits the counts (that would double-implement them) but may **optionally
enrich** the event with `durationsMs` for runs it drove (timing GitHub can't
reconstruct), which this module merges in verbatim and never computes. Reframes
the dotfiles `pr_efficiency_audit.py` profiler to the agreed `EfficiencyEvent`
shape.

The gh-history derivation lives in `efficiency-derive.ts` (the heavy seam);
`efficiency-audit.ts` owns the public shape and API. All GitHub reads route
through one injectable `GhReader` (default shells out via `boundedRun('gh',
['api', …])`), so tests feed in-memory JSON and never touch the network.

`counts` (always derived):

- **reviewIterations** — `/review` verdicts (skill-meta marked).
- **fixReviewIterations** — author (non-merge, non-web-flow) commits.
- **ciRuns** — distinct GA checks across non-merge commits.
- **preventableCiFailures** — locally-runnable checks (lint, format, tsc, black,
  pytest, …) that failed; excluded checks (e2e, integration, Vercel, …) are never
  counted.
- **redundantReviews** — `/review` posted twice on the same SHA.
- **flakyRetries** — a check that failed then passed at the same SHA.
- **mergeAttempts** — a **proxy**: `(branch-sync commits) + 1`. A true merge
  attempt is a failed squash invocation (which leaves no commit), so the history
  proxy over-counts syncs and under-counts real attempts. PR Shepherd supplies the
  authoritative count via the `mergeAttempts` enrichment for daemon-driven PRs (see
  [reporting-schema.md](../reporting-schema.md) "Merge attempts").

### API

- `auditPrEfficiency(pr, opts?) => Promise<EfficiencyEvent>` — `opts`: `repo`
  (defaults to the git remote), `mergedAt`, `durationsMs` (partial enrichment,
  merged 1:1 with missing buckets defaulting to `0`), `mergeAttempts` (authoritative
  override of the derived proxy), `reader`, `call`.
- `deriveCounts(repo, pr, reader?) => Promise<EfficiencyCounts>` — the raw
  detector.
- `ghReader` — the default shelling reader.
- `EfficiencyEvent`, `EfficiencyCounts`, `EfficiencyDurationsMs`,
  `AuditPrEfficiencyOptions`, `GhReader` types.

### CLI — `ai-efficiency-audit`

```
ai-efficiency-audit <pr> [--repo <owner/repo>] [--merged-at <iso>]
```

Prints the derived `EfficiencyEvent` as JSON. `durationsMs` enrichment is an
in-process API affordance only (the CLI derives counts; it does not measure
timing).
