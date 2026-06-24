---
type: Design
title: Reporting event schema (anomaly + efficiency)
description: Agreed shared contract for the ai-tools ↔ PR Shepherd reporting seam — the anomaly-category enum, the occurrence record, the filing API, and the efficiency-event schema. Confirmed by PR Shepherd 2026-06-23.
tags: [reporting, anomaly, efficiency, pr-shepherd, schema, contract]
---

# Reporting event schema (anomaly + efficiency)

The shared contract for `@rmartz/reporting`'s `anomaly` (#29) and
`efficiency-audit` (#30) modules, which overlap PR Shepherd's self-observability
(#109) / circuit-breaker (#107) work. **Status: agreed — PR Shepherd confirmed
2026-06-23** (grounded in merged PR Shepherd code: #104 merge/branch-currency,
#107 breakers, #109 observability, #151 skill-outcome). See
[PR Shepherd handoff](pr-shepherd-handoff.md) for the broader delegation contract.

## The seam (who emits, who files)

- **PR Shepherd detects** engine anomalies and **emits an `AnomalyOccurrence`**;
  #109 files through an injectable **`IssueFiler` seam** (deduped by
  `Anomaly.dedupeKey`). PR Shepherd implements `IssueFiler` as an adapter over
  `@rmartz/reporting.reportAnomaly`, mapping its `AnomalyKind` → `category`/
  `subject`, once the package is published.
- **ai-tools `@rmartz/reporting` files it** — it owns the category→ledger-title
  mapping and the find-or-create-or-append I/O into **`rmartz/ai-reports`**
  (`tracking` label). PR Shepherd never writes reports into its own issues; the
  deprecated `coordinator-self-report` pattern (PR Shepherd #168) is retired.
- Harness/agents emit the same record shape for harness-observed anomalies
  (flaky tests, failed local validation) directly via `@rmartz/reporting`.

ai-tools is the single authority for category→title, so both sides dedup onto
identical ledgers.

## AnomalyCategory (closed enum, kebab-case)

| Category                  | Emitter (PR Shepherd layer)               | Stable ledger title (ai-tools-owned)                               |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `duration-outlier`        | #109 observability                        | `tracking: step duration outlier (duration-outlier)`               |
| `merge-failure`           | #109 observability                        | `tracking: merge failure (merge-failure)`                          |
| `mass-blocking`           | #109 observability                        | `tracking: mass PR blocking (mass-blocking)`                       |
| `timeout-then-fast-retry` | #109 observability                        | `tracking: step timeout then fast retry (timeout-then-fast-retry)` |
| `fix-review-loop`         | #109 observability                        | `tracking: non-converging fix-review loop (fix-review-loop)`       |
| `high-retry-rate`         | #109 observability                        | `tracking: high step retry rate (high-retry-rate)`                 |
| `ci-budget-exhausted`     | #107 breaker layer                        | `tracking: CI budget exhausted (ci-budget-exhausted)`              |
| `main-broken`             | #107 breaker layer                        | `tracking: main branch broken (main-broken)`                       |
| `same-action-reroute`     | gate/convergence (#105) — not wired yet   | `tracking: same-action reroute (same-action-reroute)`              |
| `max-iterations`          | convergence (Escalate) — not wired yet    | `tracking: coordinator max iterations (max-iterations)`            |
| `human-intervention`      | gate (hard_reject / Park) — not wired yet | `tracking: human intervention required (human-intervention)`       |
| `flaky-test`              | harness/agents                            | `tracking: flaky test (flaky-test)`                                |
| `failed-local-validation` | harness/agents                            | `tracking: failed local validation (failed-local-validation)`      |

Notes:

- The `(<category>)` suffix is the stable dedup key. Identical title ⇒ same ledger.
- **`premature-exit`** is folded into the emitters above — the Skill Outcome
  Protocol (#151) makes "no outcome record ⇒ retry" uniform, so a premature exit
  surfaces via `timeout-then-fast-retry` / `high-retry-rate` rather than its own
  category. (The three dotfiles `premature_exit_*` categories are retired.)
- The `… — not wired yet` rows are valid PR Shepherd concepts in the
  gate/convergence layer (`detectSameActionLoop` #105, `resolveConvergence →
Escalate`, `SkillOutcome.hard_reject` / gate `Park`) but do **not** emit
  occurrences yet. The slugs are reserved.
- `#107` breakers latch/quarantine at runtime and #109 emits nothing when they
  trip; PR Shepherd emits these two from the **breaker layer** (strongest
  "systemically wrong" signal). `main-broken` carries the bad SHA in `evidence`.

## AnomalyOccurrence record

```ts
interface AnomalyOccurrence {
  category: AnomalyCategory; // closed enum above
  subject?: string; // refines the ledger (kebab-case), e.g. skill name for fix-review-loop
  summary: string; // one-line human description
  detail?: string; // longer body: what was observed, where, expected vs actual
  sourceRepo: string; // 'owner/repo'  (PR Shepherd maps from its `repo`)
  pr?: number; //          (PR Shepherd maps from its `prNumber`)
  evidence?: Record<string, string | number>; // structured specifics (retryCount, badSha, durationMs, …)
  // correlation (all optional; supply what the emitter has — names match PR Shepherd verbatim):
  runId?: string;
  stepInstanceId?: string;
  headSha?: string;
  gitHash?: string; // provenance: commit the PR Shepherd bundle was built from
  skillVersion?: string; // optional skill-def version
  transcriptId?: string; // dispatched-agent transcript (not persisted by PR Shepherd; from run context when available)
  timestamp: string; // ISO-8601 UTC (PR Shepherd converts its epoch-ms EventRecord.createdAt at emit)
}
```

Envelope mapping (PR Shepherd record → this wire format): `repo → sourceRepo`,
`prNumber → pr`, epoch-ms `createdAt → ISO timestamp`. `runId` / `stepInstanceId`
/ `headSha` / `gitHash` / `skillVersion` are verbatim from `SkillOutcomeRecord` /
`EventRecord`.

## Filing API

```ts
// @rmartz/reporting (anomaly.ts, #29):
function reportAnomaly(
  occ: AnomalyOccurrence,
  opts?: { repo?: string; cwd?: string }, // repo defaults to rmartz/ai-reports
): Promise<string | null>; // ledger URL, or null (soft-fail)
```

Maps `category` (+ `subject`) → the stable title, renders the body via the
existing `formatOccurrence` header, and calls `reportToTracking`
(find-or-create-or-append). **PR Shepherd's `IssueFiler` adapter passes a
category + occurrence; it never constructs the title.** Also shipped as the
`ai-report-anomaly` CLI for non-TS emitters.

## EfficiencyEvent schema

**Mode (agreed): ai-tools derives the counts standalone** from GitHub PR history
(a cross-repo, all-PRs profiler — PR Shepherd's "derive-from-GitHub / never
durably store" principle means its event stream is not a historical archive).
PR Shepherd may **optionally enrich** a record with `durationsMs` for runs it
drove (timing GitHub can't reconstruct), via the same emit seam as anomalies — it
does **not** emit the counts (that would double-implement detectors).

```ts
interface EfficiencyEvent {
  pr: number;
  sourceRepo: string;
  mergedAt?: string; // ISO-8601
  counts: {
    // derived by @rmartz/efficiency-audit from GitHub history:
    reviewIterations: number;
    fixReviewIterations: number;
    ciRuns: number;
    preventableCiFailures: number; // failures a local pre-push check would have caught
    redundantReviews: number;
    flakyRetries: number;
    mergeAttempts: number;
  };
  durationsMs?: {
    // optional PR-Shepherd enrichment; names match its StepMetricsSchema 1:1:
    claude: number; // claudeMs
    active: number; // activeMs
    scheduleWait: number; // scheduleWaitMs
    externalWait: number; // externalWaitMs
  };
}
```

Caveat: at merge granularity PR Shepherd's `MergeEfficiencyMetrics` surfaces only
`claudeMs` + `externalWaitMs`; all four buckets exist at step/run level.

## PR Shepherd vocabulary (confirmed, verbatim from merged code)

- **`SkillOutcome`**: `approve`, `error`, `hard_reject`, `no_op`, `soft_reject`.
- **`SkillOutcomeRecord`**: `skill, skillVersion, gitHash, outcome, runId,
stepInstanceId, headSha, timestamp` (ISO). Marker `<!-- skill-outcome: {json} -->`
  (distinct from the `skill-meta` marker).
- **`EventType`**: `run_started/completed/blocked`, `step_started/completed/
failed/retried`, `merge_completed/failed`.
- **`EventRecord`**: `id, runId, repo, prNumber, headSha?, decidingGate?,
eventType, stepInstanceId?, attempts, outcome?, logs[], createdAt` (epoch-ms).
- **`AnomalyKind`**: `duration_outlier, fix_review_loop, high_retry_rate,
mass_blocking, merge_failure, timeout_then_fast_retry`;
  `Anomaly = { kind, dedupeKey, title, body }`. PR Shepherd's `IssueFiler` adapter
  maps `AnomalyKind` (snake_case) → this enum's `category` (kebab-case).
- **Timing**: step `{ claudeMs, activeMs, scheduleWaitMs, externalWaitMs }`; run
  `{ total*Ms }`; merge `MergeEfficiencyMetrics { runId, repo, prNumber, headSha?,
wallClockMs, claudeMs, externalWaitMs, reviewCycles, retries, mergedFirstTry }`.

## Resolutions (PR Shepherd, 2026-06-23)

1. **premature-exit** — collapsed (retired); surfaces via `timeout-then-fast-retry`
   / `high-retry-rate`. ✅
2. **Coverage** — added `timeout-then-fast-retry`, `fix-review-loop`,
   `high-retry-rate` (#109) + `ci-budget-exhausted`, `main-broken` (#107). ✅
3. **Efficiency** — ai-tools derives counts standalone; PR Shepherd optionally
   enriches `durationsMs`. Four bucket names match 1:1. ✅
4. **Correlation** — `runId`/`stepInstanceId`/`headSha` exact; `engineVersion →
gitHash`; added optional `skillVersion`; envelope mappings documented. ✅
5. **Filing** — #109 calls `reportAnomaly` via its `IssueFiler` seam; #168
   retired. ✅ (Wiring is a PR Shepherd follow-up, gated on publishing
   `@rmartz/reporting`.)
