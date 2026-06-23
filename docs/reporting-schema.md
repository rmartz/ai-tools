---
type: Design
title: Reporting event schema (anomaly + efficiency)
description: Proposed shared contract for the ai-tools ↔ PR Shepherd reporting seam — the anomaly-category enum, the occurrence record, the filing API, and the efficiency-event schema. Pending PR Shepherd (#109) confirmation.
tags: [reporting, anomaly, efficiency, pr-shepherd, schema, proposal]
---

# Reporting event schema (anomaly + efficiency) — proposal

`@rmartz/reporting`'s `anomaly` and `efficiency-audit` modules (ai-tools #29/#30,
**deferred** until this is agreed) overlap PR Shepherd's open self-observability
work (**#109**). To avoid two parallel taxonomies, this defines the shared
contract. **Status: proposal — pending PR Shepherd confirmation** (see the open
questions at the end). See [PR Shepherd handoff](pr-shepherd-handoff.md) for the
broader delegation contract.

## The seam (who emits, who files)

- **PR Shepherd #109 detects** engine-internal anomalies over its own event
  stream and **emits an `AnomalyOccurrence`**.
- **ai-tools `@rmartz/reporting` files it** — it owns the category→ledger-title
  mapping and the find-or-create-or-append I/O into **`rmartz/ai-reports`**
  (`tracking` label). PR Shepherd does **not** write reports into its own issues;
  the deprecated `coordinator-self-report` pattern (PR Shepherd #168) is retired.
- Harness/agents (outside PR Shepherd) emit the same record shape for
  harness-observed anomalies (flaky tests, failed local validation) directly via
  `@rmartz/reporting`.

So the contract is three things: the **category enum**, the **occurrence record**,
and the **filing API**. ai-tools is the single authority for category→title so
both sides dedup onto identical ledgers.

## AnomalyCategory (closed enum, kebab-case)

| Category                  | Emitter          | Stable ledger title (ai-tools-owned)                           |
| ------------------------- | ---------------- | -------------------------------------------------------------- |
| `same-action-reroute`     | PR Shepherd #109 | `tracking: same-action reroute (same-action-reroute)`          |
| `max-iterations`          | PR Shepherd #109 | `tracking: coordinator max iterations (max-iterations)`        |
| `human-intervention`      | PR Shepherd #109 | `tracking: human intervention required (human-intervention)`   |
| `premature-exit`          | PR Shepherd #109 | `tracking: skill ended prematurely (premature-exit:<subject>)` |
| `merge-failure`           | PR Shepherd #109 | `tracking: merge failure (merge-failure)`                      |
| `duration-outlier`        | PR Shepherd #109 | `tracking: step duration outlier (duration-outlier)`           |
| `mass-blocking`           | PR Shepherd #109 | `tracking: mass PR blocking (mass-blocking)`                   |
| `flaky-test`              | harness/agents   | `tracking: flaky test (flaky-test)`                            |
| `failed-local-validation` | harness/agents   | `tracking: failed local validation (failed-local-validation)`  |

Notes:

- The `(<category>)` suffix is the stable dedup key (mirrors the dotfiles
  `… (anomaly)` convention). Identical title ⇒ same ledger.
- **`premature-exit` consolidation:** the dotfiles kept three categories
  (`premature_exit_review` / `_fix_review` / `_merge`) → three ledgers. Since the
  Skill Outcome Protocol now makes "no outcome record ⇒ retry" uniform across
  skills, this proposes **one** `premature-exit` category with the skill carried
  in `occurrence.subject`, and the title template appends `:<subject>` so
  per-skill ledgers are preserved (`premature-exit:review`,
  `premature-exit:merge`) without three enum members. _Open question 1._
- The dotfiles `AUTO_CREATE_TRACKING_CATEGORIES` distinction (self-bootstrap the
  ledger on first occurrence vs. degrade to a per-PR issue) collapses here:
  ai-reports is the ledger host, so **every** category find-or-create-or-appends
  its ledger on first occurrence.

## AnomalyOccurrence record

```ts
interface AnomalyOccurrence {
  category: AnomalyCategory; // closed enum above
  subject?: string; // refines the ledger (e.g. the skill for premature-exit): kebab-case
  summary: string; // one-line human description
  detail?: string; // longer body: what was observed, where, expected vs actual
  sourceRepo: string; // 'owner/repo' the anomaly occurred in
  pr?: number;
  evidence?: Record<string, string | number>; // structured specifics (retryCount, durationMs, blockedCount, …)
  // correlation (all optional; supply what the emitter has):
  runId?: string; // PR Shepherd run id
  stepInstanceId?: string; // PR Shepherd step instance
  headSha?: string;
  transcriptId?: string; // dispatched-agent transcript
  engineVersion?: string; // PR Shepherd build (≈ dotfiles coordinatorSha)
  timestamp: string; // ISO-8601 UTC
}
```

This extends `@rmartz/reporting`'s existing `OccurrenceMeta`
(`sourceRepo`/`coordinatorSha`/`skill`/`pr`/`transcriptId`/`skillMeta`); the
correlation fields above are its superset for the PR Shepherd engine.

## Filing API

```ts
// @rmartz/reporting (anomaly.ts, #29):
function reportAnomaly(
  occ: AnomalyOccurrence,
  opts?: { repo?: string; cwd?: string }, // repo defaults to rmartz/ai-reports
): Promise<string | null>; // ledger URL, or null (soft-fail)
```

`reportAnomaly` maps `category` (+ `subject`) → the stable title, renders the
occurrence body via the existing `formatOccurrence` header, and calls
`reportToTracking` (find-or-create-or-append). **PR Shepherd passes a category +
occurrence; it never constructs the title.** Also shipped as the
`ai-report-anomaly` CLI for non-TS emitters.

## EfficiencyEvent schema (lighter half)

PR Shepherd already records per-step timing (the four buckets:
claude / active / schedule-wait / external-wait) and per-merge metrics over its
own runs (#109 / ARCHITECTURE Timing Metrics). ai-tools `efficiency-audit` (#30)
is a **deterministic profiler of PR history** (preventable CI failures, redundant
reviews, flakes). To avoid double-implementing detectors, the proposed shared
per-PR record:

```ts
interface EfficiencyEvent {
  pr: number;
  sourceRepo: string;
  mergedAt?: string; // ISO-8601
  counts: {
    reviewIterations: number;
    fixReviewIterations: number;
    ciRuns: number;
    preventableCiFailures: number; // failures a local pre-push check would have caught
    redundantReviews: number;
    flakyRetries: number;
    mergeAttempts: number;
  };
  durationsMs?: {
    claude: number;
    active: number;
    scheduleWait: number;
    externalWait: number;
  };
}
```

Two modes, to be decided (_open question 3_): (a) PR Shepherd #109 **emits**
`EfficiencyEvent`s and `efficiency-audit` ingests them; (b) `efficiency-audit`
**derives** the counts standalone from GitHub PR history and PR Shepherd keeps its
own runtime telemetry separate. The field names above are the contract either way.

## Open questions for PR Shepherd (#109)

1. **`premature-exit` consolidation** — OK to collapse the three dotfiles
   categories into one + `subject`, with per-skill ledgers via the title
   template? Or keep distinct categories?
2. **Category coverage** — does #109 detect engine anomalies **not** in the enum
   above (e.g. CI-budget-exhausted, main-broken from the circuit breakers #107)?
   If so, propose the slug + ledger title.
3. **Efficiency mode** — (a) emit `EfficiencyEvent`s for ai-tools to ingest, or
   (b) ai-tools derives standalone? And are the four duration buckets the right
   shared names?
4. **Correlation field names** — confirm `runId` / `stepInstanceId` / `headSha` /
   `engineVersion` match PR Shepherd's actual identifiers (align names so there is
   one vocabulary, not two).
5. **Filing direction** — confirm #109 detectors call `reportAnomaly` (→
   ai-reports) rather than writing into PR Shepherd issues, and that #168's
   `coordinator-self-report` pattern is retired.
