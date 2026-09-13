import { renderJsonMarker, parseLatestJsonMarker, listIssueComments } from '@rmartz/github';
import type { GhCallOptions } from '@rmartz/github';

/**
 * The review-cycle record contract: the machine-readable records the craft skills
 * emit and a runner consumes. `review` / `dependabot-review` emit a
 * **findings** record; `synthesize-review` emits a **synthesis** record (the routing
 * verdict + thread dispositions + a `fix-review` action-list); `fix-review` emits a
 * **fix-confirmation** record. Each is carried as a hidden PR-comment marker
 * (`@rmartz/github` `renderJsonMarker`), keyed by `prHead` so a runner ignores
 * records left by an earlier head. This module owns the shapes + kinds; the marker
 * envelope + the deciding-vs-doing seam are stable, per `docs/pr-shepherd-handoff.md`.
 */

/** Marker kinds — the string that identifies each record on the PR. */
export const REVIEW_RECORD_KINDS = {
  findings: 'review-findings',
  synthesis: 'review-synthesis',
  fixConfirmation: 'fix-confirmation-record',
} as const;

/** Proposed severity of a single finding (a proposal — the verdict is synthesize-review's). */
export type FindingSeverity = 'blocking' | 'non-blocking' | 'needs-human-input';

/** One review finding. `category` is the finding-category enum documented in `skills/review.md`. */
export interface ReviewFinding {
  category: string;
  severity: FindingSeverity;
  location: { path: string; line?: number };
  summary: string;
  suggestedText?: string;
}

/** Written by `review` / `dependabot-review`; read by `synthesize-review`. */
export interface ReviewFindingsRecord {
  skill: 'review' | 'dependabot-review';
  prHead: string;
  diffScope: 'full' | 'incremental';
  findings: ReviewFinding[];
}

/** The routing verdict enum (maps onto PR Shepherd's Skill-Outcome Protocol outcome). */
export type ReviewVerdict = 'approve' | 'soft_reject' | 'hard_reject' | 'no_op' | 'error';

/** What `synthesize-review` decided to do with one existing review thread. */
export type ThreadDisposition = 'fix' | 'defer' | 'dismiss' | 'resolve' | 'merge';

export interface ThreadDispositionEntry {
  url: string;
  disposition: ThreadDisposition;
  replyText: string;
}

export interface RequiredChange {
  location: { path: string; line?: number };
  guidance: string;
  suggestedText?: string;
}

/** The machine-readable hand-off `fix-review` executes. */
export interface ReviewActionList {
  requiredChanges: RequiredChange[];
  issuesToFile: { title: string; body: string }[];
  titleDescriptionEdits?: { title?: string; body?: string };
}

/** Written by `synthesize-review`; read by the runner (posts) and by `fix-review` (acts). */
export interface ReviewSynthesisRecord {
  skill: 'synthesize-review';
  prHead: string;
  verdict: ReviewVerdict;
  /** The human-readable review markdown the runner posts via post-review-verdict. */
  reviewBody: string;
  threadDispositions: ThreadDispositionEntry[];
  actionList: ReviewActionList;
  uat: { status: 'exempt' | 'pending' | 'ready' };
}

/** Written by `fix-review`; read by the runner (posts the fix confirmation). */
export interface FixConfirmationRecord {
  skill: 'fix-review';
  prHead: string;
  outcome: 'fixed' | 'skipped' | 'ci-only';
  body: string;
}

/** Render any review-cycle record as its hidden PR-comment marker. */
export function renderFindingsRecord(record: ReviewFindingsRecord): string {
  return renderJsonMarker(REVIEW_RECORD_KINDS.findings, record);
}
export function renderSynthesisRecord(record: ReviewSynthesisRecord): string {
  return renderJsonMarker(REVIEW_RECORD_KINDS.synthesis, record);
}
export function renderFixConfirmationRecord(record: FixConfirmationRecord): string {
  return renderJsonMarker(REVIEW_RECORD_KINDS.fixConfirmation, record);
}

/** Fetch a PR's comments and return the latest record of `kind` for `prHead`, or null. */
async function readLatest<T extends { prHead: string }>(
  kind: string,
  repo: string,
  pr: number,
  prHead: string,
  opts: GhCallOptions = {},
): Promise<T | null> {
  const comments = await listIssueComments(repo, pr, opts);
  return parseLatestJsonMarker<T>(
    kind,
    comments.map((c) => c.body),
    { match: (r) => r.prHead === prHead },
  );
}

export function readLatestFindings(
  repo: string,
  pr: number,
  prHead: string,
  opts?: GhCallOptions,
): Promise<ReviewFindingsRecord | null> {
  return readLatest<ReviewFindingsRecord>(REVIEW_RECORD_KINDS.findings, repo, pr, prHead, opts);
}
export function readLatestSynthesis(
  repo: string,
  pr: number,
  prHead: string,
  opts?: GhCallOptions,
): Promise<ReviewSynthesisRecord | null> {
  return readLatest<ReviewSynthesisRecord>(REVIEW_RECORD_KINDS.synthesis, repo, pr, prHead, opts);
}
export function readLatestFixConfirmation(
  repo: string,
  pr: number,
  prHead: string,
  opts?: GhCallOptions,
): Promise<FixConfirmationRecord | null> {
  return readLatest<FixConfirmationRecord>(
    REVIEW_RECORD_KINDS.fixConfirmation,
    repo,
    pr,
    prHead,
    opts,
  );
}
