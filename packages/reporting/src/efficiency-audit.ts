import { currentRepo, type GhCallOptions } from '@rmartz/github';
import {
  deriveCounts,
  ghReader,
  type EfficiencyCounts,
  type GhReader,
} from './efficiency-derive.js';

/**
 * PR efficiency audit: derive an {@link EfficiencyEvent} for a PR **standalone**
 * from GitHub history. ai-tools owns the count detectors (a cross-repo, all-PRs
 * profiler); PR Shepherd never emits the *derived* counts — it would
 * double-implement the detectors. It may **optionally enrich** the event with
 * data history can't reconstruct: `durationsMs` (timing) and an authoritative
 * `mergeAttempts` (from its durable per-(PR, head-SHA) failed-squash markers).
 * This module merges those in verbatim but never computes them — the derived
 * `mergeAttempts` is only a proxy (see {@link AuditPrEfficiencyOptions}).
 *
 * Reframes the dotfiles `pr_efficiency_audit.py` profiler to the agreed
 * `EfficiencyEvent` wire contract (`docs/reporting-schema.md`). The gh-history
 * derivation lives in `efficiency-derive.ts`; this module owns the public shape
 * and API. All GitHub reads are injectable for hermetic tests.
 */

export type { EfficiencyCounts } from './efficiency-derive.js';

/**
 * Optional PR-Shepherd timing enrichment. Names match its `StepMetricsSchema`
 * 1:1; units are milliseconds. ai-tools never computes these — a caller passes
 * what it measured (any subset) and {@link auditPrEfficiency} merges it in.
 */
export interface EfficiencyDurationsMs {
  /** `claudeMs`. */
  claude: number;
  /** `activeMs`. */
  active: number;
  /** `scheduleWaitMs`. */
  scheduleWait: number;
  /** `externalWaitMs`. */
  externalWait: number;
}

/**
 * The wire-contract efficiency record (verbatim from `docs/reporting-schema.md`).
 * `counts` is always present (derived standalone); `durationsMs` only when a
 * caller supplies the enrichment.
 */
export interface EfficiencyEvent {
  pr: number;
  sourceRepo: string;
  mergedAt?: string;
  counts: EfficiencyCounts;
  durationsMs?: EfficiencyDurationsMs;
}

export interface AuditPrEfficiencyOptions {
  /** `owner/repo`. Resolved from the current git remote when omitted. */
  repo?: string;
  /** ISO-8601 merge timestamp, surfaced verbatim on the event. */
  mergedAt?: string;
  /** Optional PR-Shepherd timing enrichment (partial accepted; merged 1:1). */
  durationsMs?: Partial<EfficiencyDurationsMs>;
  /**
   * Authoritative `mergeAttempts` from PR Shepherd (failed-squash markers + 1).
   * When supplied — i.e. the PR was daemon-driven — it **overrides** the derived
   * history proxy, which over-counts branch syncs and is blind to failed squashes.
   */
  mergeAttempts?: number;
  /** Injectable GitHub history reader (default shells out via `gh`). */
  reader?: GhReader;
  /** gh-call options forwarded to repo resolution. */
  call?: GhCallOptions;
}

/**
 * Merge a partial `durationsMs` enrichment into a full record, defaulting any
 * unsupplied bucket to `0`. Returns `undefined` when no enrichment was given, so
 * the field is omitted from the event entirely.
 */
function mergeDurations(
  partial: Partial<EfficiencyDurationsMs> | undefined,
): EfficiencyDurationsMs | undefined {
  if (!partial) return undefined;
  return {
    claude: partial.claude ?? 0,
    active: partial.active ?? 0,
    scheduleWait: partial.scheduleWait ?? 0,
    externalWait: partial.externalWait ?? 0,
  };
}

/**
 * Compute an {@link EfficiencyEvent} for one PR. Derives `counts` from GitHub
 * history (review iterations, fix-review iterations, CI runs, preventable CI
 * failures, redundant reviews, flaky retries, and a `mergeAttempts` proxy), then
 * applies any PR-Shepherd enrichment — an authoritative `mergeAttempts` override
 * and `durationsMs` — without computing those itself. `repo` defaults to the
 * current git remote.
 *
 * Throws only when the repo cannot be resolved; the underlying gh reads throw on
 * unrecoverable API failure (the thin CLI wrapper turns that into an exit code).
 */
export async function auditPrEfficiency(
  pr: number,
  opts: AuditPrEfficiencyOptions = {},
): Promise<EfficiencyEvent> {
  const repo = opts.repo ?? (await currentRepo(opts.call ?? {}));
  if (!repo) {
    throw new Error('could not determine repo — pass repo as owner/repo');
  }

  const counts = await deriveCounts(repo, pr, opts.reader ?? ghReader);
  // Authoritative override: PR Shepherd's marker-based count beats the proxy.
  if (opts.mergeAttempts !== undefined) counts.mergeAttempts = opts.mergeAttempts;
  const durationsMs = mergeDurations(opts.durationsMs);

  const event: EfficiencyEvent = { pr, sourceRepo: repo, counts };
  if (opts.mergedAt) event.mergedAt = opts.mergedAt;
  if (durationsMs) event.durationsMs = durationsMs;
  return event;
}
