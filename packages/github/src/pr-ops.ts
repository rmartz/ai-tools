import { ghCall, issueNumber, type GhCallOptions, type Transport } from './gh-call.js';

/**
 * Generic PR-write primitives: create a PR, submit a review, merge a PR. These
 * are thin, label-free, gate-free GitHub API wrappers — the shared client, same
 * posture as `issue-ops` (REST-first + GraphQL fallback on rate-limit, soft-fail
 * to `null`). The *verdict-recording protocol* and *gated merge orchestration*
 * (mutex, idempotency, pre-merge re-validation) are PR Shepherd's, not here. TS
 * port of the `submit_review` / `merge_pull_request` helpers from dotfiles'
 * `gh_issue_ops.py`.
 */

export type ReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';

const EVENT_FLAG: Record<ReviewEvent, string> = {
  APPROVE: '--approve',
  COMMENT: '--comment',
  REQUEST_CHANGES: '--request-changes',
};

export interface SubmitReviewOptions extends GhCallOptions {
  body?: string;
}

/**
 * Submit a PR review with `event` ∈ {APPROVE, COMMENT, REQUEST_CHANGES}. Returns
 * truthy stdout on success, `null` on failure, an unrecognized event, or an
 * unparseable PR ref.
 */
export async function submitReview(
  repo: string,
  pr: string | number,
  event: ReviewEvent,
  opts: SubmitReviewOptions = {},
): Promise<string | null> {
  if (!(event in EVENT_FLAG)) return null;
  const num = issueNumber(pr);
  if (num === null) return null;
  const body = opts.body ?? '';
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/pulls/${num}/reviews`, '--input', '-'],
    stdin: JSON.stringify({ event, body }),
  };
  const fb: Transport = {
    argv: ['gh', 'pr', 'review', num, '--repo', repo, EVENT_FLAG[event], '--body-file', '-'],
    stdin: body,
  };
  const out = await ghCall(rest, fb, opts);
  return out ? out : null;
}

export interface CreatePullRequestOptions extends GhCallOptions {
  base: string;
  head: string;
  title: string;
  body?: string;
  draft?: boolean;
}

/**
 * Open a pull request. Returns the new PR's URL, or `null` on failure. `draft`
 * defaults to `false`. The PR *lifecycle* — `[WIP]`/draft promotion, labels,
 * milestone — belongs to the caller/coordinator, not this raw create call.
 */
export async function createPullRequest(
  repo: string,
  opts: CreatePullRequestOptions,
): Promise<string | null> {
  const body = opts.body ?? '';
  const payload: Record<string, unknown> = {
    title: opts.title,
    head: opts.head,
    base: opts.base,
    body,
  };
  if (opts.draft) payload.draft = true;
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/pulls`, '--input', '-', '--jq', '.html_url'],
    stdin: JSON.stringify(payload),
  };
  const fbArgv = [
    'gh',
    'pr',
    'create',
    '--repo',
    repo,
    '--base',
    opts.base,
    '--head',
    opts.head,
    '--title',
    opts.title,
    '--body-file',
    '-',
  ];
  if (opts.draft) fbArgv.push('--draft');
  const out = await ghCall(rest, { argv: fbArgv, stdin: body }, opts);
  return out ? out.trim() || null : null;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

/**
 * Merge a PR using `method` (default `squash`). Returns the merge commit `sha`,
 * `true` when the SHA is absent but the merge succeeded, or `null` on failure /
 * an unparseable PR ref. This is the raw merge call — the gated, serialized merge
 * path belongs to PR Shepherd.
 */
export async function mergePullRequest(
  repo: string,
  pr: string | number,
  method: MergeMethod = 'squash',
  call: GhCallOptions = {},
): Promise<string | true | null> {
  const num = issueNumber(pr);
  if (num === null) return null;
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      '-X',
      'PUT',
      `repos/${repo}/pulls/${num}/merge`,
      '--input',
      '-',
      '--jq',
      '.sha',
    ],
    stdin: JSON.stringify({ merge_method: method }),
  };
  const fb: Transport = {
    argv: ['gh', 'pr', 'merge', num, '--repo', repo, `--${method}`],
  };
  const out = await ghCall(rest, fb, call);
  if (out === null) return null;
  return out.trim() || true;
}
