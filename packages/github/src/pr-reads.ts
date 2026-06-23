import { ghCall, type GhCallOptions, type Transport } from './gh-call.js';

/**
 * PR read helpers beyond the coordination summary: a PR's review history and its
 * conversation (issue) comments. Like the rest of the client these are REST-first
 * via `ghCall` and soft-fail to `[]` — a context gap degrades a caller (e.g. the
 * `review` skill) rather than crashing it. They know nothing about verdict labels
 * or gate state; that contract lives in PR Shepherd.
 */

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
  user: string | null;
}

/**
 * List a PR's reviews, most-recent first, with body text dropped — only the
 * `{id, state, submittedAt, commitId, user}` axis a caller needs to size an
 * incremental diff. Soft-fails to `[]`. No GraphQL fallback: review history has
 * no clean equivalent `gh` subcommand, so a `null` REST result yields `[]`.
 */
export async function listPrReviews(
  repo: string,
  prNumber: number,
  call: GhCallOptions = {},
): Promise<PrReview[]> {
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      `repos/${repo}/pulls/${prNumber}/reviews`,
      '--jq',
      '[.[] | {id, state, submitted_at, commit_id, user: .user.login}]',
    ],
  };
  const out = await ghCall(rest, null, call);
  if (out === null) return [];
  let raw: RawReview[];
  try {
    raw = (JSON.parse(out) as RawReview[]) || [];
  } catch {
    return [];
  }
  return raw
    .map((r) => ({
      id: r.id,
      state: r.state,
      submittedAt: r.submitted_at,
      commitId: r.commit_id,
      user: r.user ?? '',
    }))
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
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
 * List a PR's conversation (issue) comments across all pages. Used to scan for
 * posted screenshots and prior engagement. Soft-fails to `[]`. `gh api
 * --paginate` merges the per-page arrays into one JSON array.
 */
export async function listIssueComments(
  repo: string,
  prNumber: number,
  call: GhCallOptions = {},
): Promise<IssueComment[]> {
  const rest: Transport = {
    argv: ['gh', 'api', '--paginate', `repos/${repo}/issues/${prNumber}/comments`],
  };
  const out = await ghCall(rest, null, call);
  if (out === null) return [];
  let raw: RawIssueComment[];
  try {
    raw = (JSON.parse(out) as RawIssueComment[]) || [];
  } catch {
    return [];
  }
  return raw.map((c) => ({ id: c.id, author: c.user?.login ?? '', body: c.body ?? '' }));
}
