---
type: Design
title: Reporting event schema (anomaly + efficiency)
description: Shared contract for the reporting seam between ai-tools and its emitters — the anomaly-category enum, the occurrence record, the filing API, and the efficiency-event schema. Agreed with the (now retired) PR automation orchestrator 2026-06-23.
tags: [reporting, anomaly, efficiency, schema, contract]
---

# Reporting event schema (anomaly + efficiency)

The shared contract for `@rmartz/reporting`'s `anomaly` (#29) and
`efficiency-audit` (#30) modules. It was agreed on 2026-06-23 with the retired PR
automation orchestrator, whose self-observability and circuit-breaker layers were
its first non-harness emitter. The schema stands for any emitter; names below that
came from that orchestrator are kept so records stay compatible.

## The seam (who emits, who files)

- **An orchestrator detects** engine anomalies and **emits an
  `AnomalyOccurrence`**, filing through an injectable **`IssueFiler` seam**
  (deduped by `Anomaly.dedupeKey`). The emitter implements `IssueFiler` as an
  adapter over `@rmartz/reporting.reportAnomaly`, mapping its own anomaly kind →
  `category`/`subject`.
- **ai-tools `@rmartz/reporting` files it** — it owns the category→ledger-title
  mapping and the find-or-create-or-append I/O into the central reports repo
  (**`AI_TRACKING_REPO`**)
  (`tracking` label). Emitters never write reports into their own issues; the
  deprecated `coordinator-self-report` pattern is retired.
- Harness/agents emit the same record shape for harness-observed anomalies
  (flaky tests, failed local validation) directly via `@rmartz/reporting`.

ai-tools is the single authority for category→title, so every emitter dedups onto
identical ledgers.

## AnomalyCategory (closed enum, kebab-case)

| Category                  | Emitter (orchestrator layer)              | Stable ledger title (ai-tools-owned)                               |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `duration-outlier`        | observability                             | `tracking: step duration outlier (duration-outlier)`               |
| `merge-failure`           | observability                             | `tracking: merge failure (merge-failure)`                          |
| `mass-blocking`           | observability                             | `tracking: mass PR blocking (mass-blocking)`                       |
| `timeout-then-fast-retry` | observability                             | `tracking: step timeout then fast retry (timeout-then-fast-retry)` |
| `fix-review-loop`         | observability                             | `tracking: non-converging fix-review loop (fix-review-loop)`       |
| `high-retry-rate`         | observability                             | `tracking: high step retry rate (high-retry-rate)`                 |
| `ci-budget-exhausted`     | breaker layer                             | `tracking: CI budget exhausted (ci-budget-exhausted)`              |
| `main-broken`             | breaker layer                             | `tracking: main branch broken (main-broken)`                       |
| `same-action-reroute`     | gate/convergence — not wired yet          | `tracking: same-action reroute (same-action-reroute)`              |
| `max-iterations`          | convergence (Escalate) — not wired yet    | `tracking: coordinator max iterations (max-iterations)`            |
| `human-intervention`      | gate (hard_reject / Park) — not wired yet | `tracking: human intervention required (human-intervention)`       |
| `flaky-test`              | harness/agents                            | `tracking: flaky test (flaky-test)`                                |
| `failed-local-validation` | harness/agents                            | `tracking: failed local validation (failed-local-validation)`      |

Notes:

- The `(<category>)` suffix is the stable dedup key. Identical title ⇒ same ledger.
- **`premature-exit`** is folded into the emitters above — the Skill Outcome
  Protocol makes "no outcome record ⇒ retry" uniform, so a premature exit
  surfaces via `timeout-then-fast-retry` / `high-retry-rate` rather than its own
  category. (The three dotfiles `premature_exit_*` categories are retired.)
- The `… — not wired yet` rows are gate/convergence-layer concepts (same-action
  loop detection, convergence `Escalate`, `SkillOutcome.hard_reject` / gate
  `Park`) that no emitter produces yet. The slugs are reserved.
- Breakers latch/quarantine at runtime and the observability layer emits nothing
  when they trip; these two come from the **breaker layer** (strongest
  "systemically wrong" signal). `main-broken` carries the bad SHA in `evidence`.

## AnomalyOccurrence record

```ts
interface AnomalyOccurrence {
  category: AnomalyCategory; // closed enum above
  subject?: string; // refines the ledger (kebab-case), e.g. skill name for fix-review-loop
  summary: string; // one-line human description
  detail?: string; // longer body: what was observed, where, expected vs actual
  sourceRepo: string; // 'owner/repo'  (an emitter maps from its own `repo`)
  pr?: number; //          (an emitter maps from its own `prNumber`)
  evidence?: Record<string, string | number>; // structured specifics (retryCount, badSha, durationMs, …)
  // correlation (all optional; supply what the emitter has):
  runId?: string;
  stepInstanceId?: string;
  headSha?: string;
  gitHash?: string; // provenance: commit the emitter was built from
  skillVersion?: string; // optional skill-def version
  transcriptId?: string; // dispatched-agent transcript (from run context when available)
  timestamp: string; // ISO-8601 UTC (an emitter with epoch-ms timestamps converts at emit)
}
```

Envelope mapping (emitter record → this wire format): `repo → sourceRepo`,
`prNumber → pr`, epoch-ms `createdAt → ISO timestamp`. `runId` / `stepInstanceId`
/ `headSha` / `gitHash` / `skillVersion` pass through verbatim from the emitter's
`SkillOutcomeRecord` / `EventRecord`.

## Filing API

```ts
// @rmartz/reporting (anomaly.ts, #29):
function reportAnomaly(
  occ: AnomalyOccurrence,
  opts?: { repo?: string; cwd?: string }, // repo defaults to $AI_TRACKING_REPO
): Promise<string | null>; // ledger URL, or null (soft-fail); throws if no ledger repo is configured
```

Maps `category` (+ `subject`) → the stable title, renders the body via the
existing `formatOccurrence` header, and calls `reportToTracking`
(find-or-create-or-append). **An emitter's `IssueFiler` adapter passes a
category + occurrence; it never constructs the title.** Also shipped as the
`ai-report-anomaly` CLI for non-TS emitters.

## EfficiencyEvent schema

**Mode (agreed): ai-tools derives the counts standalone** from GitHub PR history
(a cross-repo, all-PRs profiler — an orchestrator that derives state from GitHub
and never durably stores it has no historical archive to offer). An orchestrator
may **optionally enrich** a record with data history can't reconstruct —
`durationsMs` (timing) and an authoritative `mergeAttempts` — via the same emit
seam as anomalies. It does **not** emit the _derived_ counts (that would
double-implement detectors).

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
    mergeAttempts: number; // see "merge attempts" below — derived value is a proxy
  };
  durationsMs?: {
    // optional orchestrator enrichment; names match a StepMetricsSchema 1:1:
    claude: number; // claudeMs
    active: number; // activeMs
    scheduleWait: number; // scheduleWaitMs
    externalWait: number; // externalWaitMs
  };
}
```

Caveat: at merge granularity a `MergeEfficiencyMetrics` record surfaces only
`claudeMs` + `externalWaitMs`; all four buckets exist at step/run level.

### Merge attempts (authoritative model, 2026-06-29)

A **merge attempt is an actual squash-merge _invocation_ that fails** — accounted
durably per-`(PR, head-SHA)` via hidden marker comments on the PR (so it survives
restarts and is reconstructable from the PR, not inferred from git). For a landed
SHA: `mergeAttempts = (failed-squash markers for that SHA) + 1` (the success);
across a PR's life, the sum of per-SHA failed markers + the final success.
Per-SHA failures are bounded (~3, `ESCALATION_THRESHOLD`) before the PR is blocked
rather than looping; the budget resets on a new head SHA or a human clearing
`escalation needed`.

**Not** merge attempts (never folded in): branch syncs / `update-branch` (a
separate pre-merge step); pre-merge **gate** rejections (CI-failed / CONFLICTING
caught in re-validation _before_ the squash — soft-rejects, re-queued to
review/fix); and defers (CI-running / Copilot-pending — re-poll).

**ai-tools' history-derived value is a documented PROXY:** `(branch-sync commits)

- 1`. Git history can't see a failed squash (it leaves no commit) and can't tell
  a branch sync from an attempt — so the proxy **over-counts syncs and under-counts
  true attempts**. Resolution:

* **Orchestrator-driven PRs** → the authoritative count comes from the
  orchestrator, which emits `mergeAttempts` (failed markers + 1) on
  `MergeEfficiencyMetrics`; `auditPrEfficiency`'s `mergeAttempts` enrichment
  **overrides** the proxy.
* **Any other PR** → the `(branch-sync commits) + 1` proxy stands, understood to
  diverge as above.

**Status:** the PR automation that would have emitted the authoritative count is
retired, so in practice every PR now uses the proxy. The enrichment path stays
for any future emitter.

## Emitter vocabulary (agreed names)

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
  `Anomaly = { kind, dedupeKey, title, body }`. An emitter's `IssueFiler` adapter
  maps `AnomalyKind` (snake_case) → this enum's `category` (kebab-case).
- **Timing**: step `{ claudeMs, activeMs, scheduleWaitMs, externalWaitMs }`; run
  `{ total*Ms }`; merge `MergeEfficiencyMetrics { runId, repo, prNumber, headSha?,
wallClockMs, claudeMs, externalWaitMs, reviewCycles, retries, mergedFirstTry }`.

## Resolutions (2026-06-23)

1. **premature-exit** — collapsed (retired); surfaces via `timeout-then-fast-retry`
   / `high-retry-rate`. ✅
2. **Coverage** — added `timeout-then-fast-retry`, `fix-review-loop`,
   `high-retry-rate` (observability) + `ci-budget-exhausted`, `main-broken`
   (breakers). ✅
3. **Efficiency** — ai-tools derives counts standalone; an orchestrator optionally
   enriches `durationsMs`. Four bucket names match 1:1. ✅
4. **Correlation** — `runId`/`stepInstanceId`/`headSha` exact; `engineVersion →
gitHash`; added optional `skillVersion`; envelope mappings documented. ✅
5. **Filing** — emitters call `reportAnomaly` via an `IssueFiler` seam; the
   self-report pattern is retired. ✅
