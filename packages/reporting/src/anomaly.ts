import {
  reportToTracking,
  DEFAULT_TRACKING_REPO,
  type ReportToTrackingOptions,
} from './tracking.js';

/**
 * Anomaly reporting: the ai-tools-owned bridge from a PR-Shepherd/harness
 * `AnomalyOccurrence` to a tracking ledger in `rmartz/ai-reports`.
 *
 * ai-tools is the **single authority** for the category(+subject)→ledger-title
 * mapping (see {@link LEDGER_TITLE}), so PR Shepherd's `IssueFiler` adapter and
 * harness-observed anomalies (flaky tests, failed local validation) all dedup
 * onto identical ledgers. The wire contract — the category slugs, the stable
 * ledger titles, and the {@link AnomalyOccurrence} field names — is fixed by
 * `docs/reporting-schema.md` (confirmed with PR Shepherd 2026-06-23) and is
 * spelled verbatim here.
 *
 * {@link reportAnomaly} maps category(+subject)→title, projects the
 * occurrence's correlation fields onto the existing `OccurrenceMeta` header
 * (carried through {@link reportToTracking}'s options, which render it via this
 * package's `formatOccurrence`), and calls {@link reportToTracking}
 * (find-or-create-or-append). It soft-fails to `null`, mirroring the underlying
 * ops — and also returns `null` defensively for an unknown category, so a future
 * PR-Shepherd slug can never throw at the seam.
 */

/**
 * Closed enum of anomaly categories (kebab-case wire slugs). Verbatim from the
 * schema table. `premature-exit` is **not** a category — it is retired and
 * surfaces via `timeout-then-fast-retry` / `high-retry-rate`.
 */
export type AnomalyCategory =
  | 'duration-outlier'
  | 'merge-failure'
  | 'mass-blocking'
  | 'timeout-then-fast-retry'
  | 'fix-review-loop'
  | 'high-retry-rate'
  | 'ci-budget-exhausted'
  | 'main-broken'
  | 'same-action-reroute'
  | 'max-iterations'
  | 'human-intervention'
  | 'flaky-test'
  | 'failed-local-validation';

/**
 * Stable ledger title per category — the ai-tools-owned dedup key. Identical
 * title ⇒ same ledger. The `(<category>)` suffix is the stable part; titles are
 * verbatim from the schema table. A `:<subject>` is appended by
 * {@link ledgerTitle} (not baked in here) so a refined subject still routes to a
 * distinct ledger while sharing the category prefix.
 */
const LEDGER_TITLE: Record<AnomalyCategory, string> = {
  'duration-outlier': 'tracking: step duration outlier (duration-outlier)',
  'merge-failure': 'tracking: merge failure (merge-failure)',
  'mass-blocking': 'tracking: mass PR blocking (mass-blocking)',
  'timeout-then-fast-retry': 'tracking: step timeout then fast retry (timeout-then-fast-retry)',
  'fix-review-loop': 'tracking: non-converging fix-review loop (fix-review-loop)',
  'high-retry-rate': 'tracking: high step retry rate (high-retry-rate)',
  'ci-budget-exhausted': 'tracking: CI budget exhausted (ci-budget-exhausted)',
  'main-broken': 'tracking: main branch broken (main-broken)',
  'same-action-reroute': 'tracking: same-action reroute (same-action-reroute)',
  'max-iterations': 'tracking: coordinator max iterations (max-iterations)',
  'human-intervention': 'tracking: human intervention required (human-intervention)',
  'flaky-test': 'tracking: flaky test (flaky-test)',
  'failed-local-validation': 'tracking: failed local validation (failed-local-validation)',
};

/**
 * Map a category (+ optional kebab-case subject) to its stable ledger title, or
 * `null` for an unknown category. The subject — when present — is appended as a
 * `: <subject>` suffix so e.g. a `fix-review-loop` for `/review` routes to its
 * own ledger while keeping the shared category dedup key.
 */
export function ledgerTitle(category: AnomalyCategory, subject?: string): string | null {
  const base = LEDGER_TITLE[category];
  if (base === undefined) return null;
  const trimmed = subject?.trim();
  return trimmed ? `${base}: ${trimmed}` : base;
}

/**
 * One anomaly occurrence. Wire-contract record from `docs/reporting-schema.md`;
 * PR Shepherd's `IssueFiler` adapter and harness emitters produce this shape.
 * Field names are verbatim from the schema (camelCase TS-native).
 */
export interface AnomalyOccurrence {
  /** Closed enum; selects the ledger. */
  category: AnomalyCategory;
  /** Refines the ledger (kebab-case), e.g. skill name for `fix-review-loop`. */
  subject?: string;
  /** One-line human description. */
  summary: string;
  /** Longer body: what was observed, where, expected vs actual. */
  detail?: string;
  /** `owner/repo` the occurrence is about (PR Shepherd maps from its `repo`). */
  sourceRepo: string;
  /** PR number (PR Shepherd maps from its `prNumber`). */
  pr?: number;
  /** Structured specifics (retryCount, badSha, durationMs, …). */
  evidence?: Record<string, string | number>;
  /** Run id (correlation). */
  runId?: string;
  /** Step-instance id (correlation). */
  stepInstanceId?: string;
  /** Head SHA at emit time (correlation). */
  headSha?: string;
  /** Provenance: commit the PR Shepherd bundle was built from. */
  gitHash?: string;
  /** Optional skill-def version. */
  skillVersion?: string;
  /** Dispatched-agent transcript id, when available. */
  transcriptId?: string;
  /** ISO-8601 UTC; PR Shepherd converts its epoch-ms `createdAt` at emit. */
  timestamp: string;
}

export interface ReportAnomalyOptions {
  /** Ledger repo. Defaults to {@link DEFAULT_TRACKING_REPO} (`rmartz/ai-reports`). */
  repo?: string;
  /** Working directory used to resolve the coordinator sha when reporting. */
  cwd?: string;
}

/**
 * Render the occurrence's structured fields into the Markdown body that sits
 * below the standardized metadata header (which {@link reportToTracking}
 * prepends). Summary first, then the long-form detail, then the
 * correlation/evidence specifics as a labelled list — each line only when its
 * value is present. The header-level fields (`sourceRepo`, `gitHash` →
 * coordinator, `pr`, `transcriptId`) are intentionally **not** repeated here:
 * they render once, in the header.
 */
function renderBody(occ: AnomalyOccurrence): string {
  const parts: string[] = [occ.summary];
  if (occ.detail) parts.push(occ.detail);

  const facts: string[] = [];
  const push = (label: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') facts.push(`- **${label}:** ${value}`);
  };
  push('Category', occ.category);
  push('Subject', occ.subject);
  push('Timestamp', occ.timestamp);
  push('Run', occ.runId);
  push('Step instance', occ.stepInstanceId);
  push('Head SHA', occ.headSha);
  push('Skill version', occ.skillVersion);
  for (const [key, value] of Object.entries(occ.evidence ?? {})) {
    facts.push(`- **${key}:** ${value}`);
  }
  if (facts.length) parts.push(facts.join('\n'));

  return parts.join('\n\n');
}

/**
 * File one {@link AnomalyOccurrence} against its tracking ledger.
 *
 * Maps `category` (+ `subject`) → the stable ledger title, projects the
 * occurrence's correlation fields onto the `OccurrenceMeta` header carried by
 * {@link reportToTracking}'s options (`gitHash` → coordinator sha, so the
 * bundle's provenance overrides the local git HEAD), and appends-or-creates via
 * {@link reportToTracking}. Returns the ledger URL, or `null` on soft-fail —
 * including the defensive unknown-category path, so an unrecognized slug never
 * throws at this cross-repo seam. The ledger repo defaults to
 * {@link DEFAULT_TRACKING_REPO}.
 */
export async function reportAnomaly(
  occ: AnomalyOccurrence,
  opts: ReportAnomalyOptions = {},
): Promise<string | null> {
  const title = ledgerTitle(occ.category, occ.subject);
  if (title === null) return null; // unknown/defensive: never throw at the seam

  const trackingOpts: ReportToTrackingOptions = {
    repo: opts.repo ?? DEFAULT_TRACKING_REPO,
    cwd: opts.cwd,
    sourceRepo: occ.sourceRepo,
    pr: occ.pr,
    transcriptId: occ.transcriptId,
  };
  // `gitHash` is the bundle's provenance commit; surface it as the coordinator
  // sha so it overrides reportToTracking's local-HEAD fallback. Omit when absent
  // so the local fallback still applies.
  if (occ.gitHash) trackingOpts.coordinatorSha = occ.gitHash;

  return reportToTracking(title, renderBody(occ), trackingOpts);
}
