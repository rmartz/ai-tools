import { boundedRun } from '@rmartz/agent-runtime';
import { fetchPrSummary, computePrDiff, type PrSummary, type PrDiffOptions } from '@rmartz/github';

/**
 * Review-context helpers — the *reads* the `review` skill performs to assemble a
 * picture of a PR before forming a verdict. Composition layer: it leans on
 * `@rmartz/github` for the metadata + diff primitives and fills the remaining
 * gaps (review history, issue/review comments) via `boundedRun('gh', …)`.
 *
 * GAP NOTE (for the parent): `@rmartz/github` has no read helper for a PR's
 * review history or its issue/review comment threads. `listPrReviews`,
 * `listIssueComments`, and `extractScreenshotUrls` below cover that here via raw
 * `gh`; if other layer-2 packages need the same reads, promote them into
 * `@rmartz/github` (the natural home is alongside `fetchPrSummary` in
 * `pr-summary.ts`). Everything stays soft-fail-to-`[]`/`null`, mirroring the
 * github client's posture, so a context gap never crashes a review pass.
 */

const GH_TIMEOUT_MS = 30_000;

async function ghJson<T>(args: string[], fallback: T): Promise<T> {
  try {
    const { stdout, code } = await boundedRun('gh', args, { timeoutMs: GH_TIMEOUT_MS });
    if (code !== 0) return fallback;
    return JSON.parse(stdout) as T;
  } catch {
    return fallback;
  }
}

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

export interface PrReview {
  id: number;
  state: string;
  submittedAt: string | null;
  commitId: string | null;
  user: string;
}

interface RawReview {
  id: number;
  state: string;
  submitted_at: string | null;
  commit_id: string | null;
  user: { login: string } | null;
}

/** Reviewers whose reviews are advisory only — never an authoritative prior review. */
const ADVISORY_REVIEWERS = new Set(['copilot-pull-request-reviewer[bot]', 'copilot-swe-agent']);

/**
 * List a PR's reviews (most-recent first), with body text dropped — only the
 * `{id, state, submittedAt, commitId, user}` axis the review skill needs to size
 * the incremental diff. Soft-fails to `[]`. GAP: no `@rmartz/github` equivalent.
 */
export async function listPrReviews(repo: string, prNumber: number): Promise<PrReview[]> {
  const raw = await ghJson<RawReview[]>(
    [
      'api',
      `repos/${repo}/pulls/${prNumber}/reviews`,
      '--jq',
      '[.[] | {id, state, submitted_at, commit_id, user: .user.login}]',
    ],
    [],
  );
  return raw
    .map((r) => ({
      id: r.id,
      state: r.state,
      submittedAt: r.submitted_at,
      commitId: r.commit_id,
      // The `--jq` above flattens `user` to a login string; tolerate both shapes.
      user: typeof (r.user as unknown) === 'string' ? (r.user as unknown as string) : '',
    }))
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
}

/**
 * The most recent **non-advisory** (human / first-party) review, or `null`. Copilot
 * reviews are filtered out — they are triaged as informational, never treated as
 * an authoritative prior review that sets the incremental-diff baseline.
 */
export function lastAuthoritativeReview(reviews: PrReview[]): PrReview | null {
  for (const r of reviews) {
    if (!ADVISORY_REVIEWERS.has(r.user)) return r;
  }
  return null;
}

export interface IssueComment {
  id: number;
  author: string;
  body: string;
}

interface RawIssueComment {
  id: number;
  user: { login: string } | null;
  body: string;
}

/**
 * List a PR's conversation (issue) comments. Used to scan for posted screenshots
 * and prior engagement. Soft-fails to `[]`. GAP: no `@rmartz/github` equivalent.
 */
export async function listIssueComments(repo: string, prNumber: number): Promise<IssueComment[]> {
  const raw = await ghJson<RawIssueComment[]>(
    ['api', '--paginate', `repos/${repo}/issues/${prNumber}/comments`],
    [],
  );
  return raw.map((c) => ({ id: c.id, author: c.user?.login ?? '', body: c.body ?? '' }));
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
