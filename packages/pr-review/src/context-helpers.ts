import {
  fetchPrSummary,
  computePrDiff,
  listPrReviews,
  listIssueComments,
  type PrSummary,
  type PrDiffOptions,
  type PrReview,
  type IssueComment,
} from '@rmartz/github';

/**
 * Review-context helpers — the *reads* the `review` skill performs to assemble a
 * picture of a PR before forming a verdict. Composition layer: it leans entirely
 * on `@rmartz/github` for the metadata, diff, review-history, and comment reads,
 * and adds the review-craft logic on top (which prior review is authoritative,
 * which comment bodies carry screenshots). Everything soft-fails to `[]`/`null`,
 * mirroring the github client's posture, so a context gap never crashes a pass.
 */

/** Re-export of the github client's PR-metadata read, so callers import one place. */
export async function fetchSummary(repo: string, prNumber: number): Promise<PrSummary> {
  return fetchPrSummary(repo, prNumber);
}

/** Re-export of the incremental review-diff primitive. */
export async function diffSinceLastReview(
  baseSha: string,
  headSha: string,
  repo?: string,
  opts: PrDiffOptions = {},
): Promise<string> {
  return computePrDiff(baseSha, headSha, repo, opts);
}

/** Re-export of the github client's review-history read (most-recent first). */
export { listPrReviews, listIssueComments };
export type { PrReview, IssueComment };

/** Reviewers whose reviews are advisory only — never an authoritative prior review. */
const ADVISORY_REVIEWERS = new Set(['copilot-pull-request-reviewer[bot]', 'copilot-swe-agent']);

/**
 * The most recent **non-advisory** (human / first-party) review, or `null`. Copilot
 * reviews are filtered out — they are triaged as informational, never treated as
 * an authoritative prior review that sets the incremental-diff baseline. Expects
 * `listPrReviews`' most-recent-first ordering.
 */
export function lastAuthoritativeReview(reviews: PrReview[]): PrReview | null {
  for (const r of reviews) {
    if (!ADVISORY_REVIEWERS.has(r.user)) return r;
  }
  return null;
}

const SCREENSHOT_URL_RE =
  /https:\/\/(?:github\.com\/user-attachments|user-images\.githubusercontent\.com)\/[^)\s"']+/g;

/**
 * Extract unique uploaded-image URLs from a set of comment bodies — the visual
 * gate's input. Pure; the review skill downloads + views each. Dedupes order-
 * stably so the skill's 1-based screenshot counter is deterministic.
 */
export function extractScreenshotUrls(comments: IssueComment[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const c of comments) {
    for (const m of c.body.matchAll(SCREENSHOT_URL_RE)) {
      const url = m[0];
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

export type { PrSummary } from '@rmartz/github';
