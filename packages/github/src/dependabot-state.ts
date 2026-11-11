import { ghCall, type GhCallOptions } from './gh-call.js';

/**
 * Read the Dependabot rebase/recreate lifecycle state of one PR: whether it is
 * still open, its body's rebase marker, the latest `@dependabot rebase` /
 * `recreate` request, whether Dependabot acknowledged that request, and when
 * Dependabot last pushed or commented. TS port of dotfiles'
 * `lib/dependabot_state.py`, gathered into one snapshot so a caller classifies
 * a single consistent read instead of sequencing leaf calls.
 *
 * REST-only (`gh api`): none of these reads has a clean `gh` subcommand
 * equivalent. A failed read yields `null`, so a caller can tell a transient
 * failure from "nothing to report".
 */

export const DEPENDABOT_LOGIN = 'dependabot[bot]';

const REQUEST_PREFIXES = ['@dependabot rebase', '@dependabot recreate'] as const;

/** Dependabot's own PR-body status line while it works on the branch. */
export type RebaseMarker = 'in_progress' | 'failed' | 'none';

export type PrState = 'open' | 'closed' | 'merged';

export interface DependabotRequest {
  commentId: number;
  createdAt: string;
  /** True once `dependabot[bot]` reacted to the request comment (it acks with 👍). */
  acknowledged: boolean;
}

export interface DependabotSnapshot {
  state: PrState;
  rebaseMarker: RebaseMarker;
  /** The latest rebase/recreate request, or `null` when none is on record. */
  request: DependabotRequest | null;
  /** ISO timestamp of the latest `dependabot[bot]` commit, or `''`. */
  lastBotCommitAt: string;
  /** ISO timestamp of the latest comment `dependabot[bot]` posted, or `''`. */
  lastBotCommentAt: string;
}

interface RawPull {
  state: string;
  merged?: boolean;
  merged_at?: string | null;
  body: string | null;
}

interface RawComment {
  id: number;
  created_at: string;
  body: string | null;
  user: { login: string } | null;
}

interface RawCommit {
  author: { login: string } | null;
  commit: { committer: { date: string } | null };
}

interface RawReaction {
  user: { login: string } | null;
}

/** Classify a Dependabot PR body's rebase-status line. */
export function bodyRebaseMarker(body: string): RebaseMarker {
  if (/Dependabot rebase failed/i.test(body)) return 'failed';
  if (/Dependabot is rebasing this PR/i.test(body)) return 'in_progress';
  return 'none';
}

/** True when a comment body is a `@dependabot rebase` / `recreate` command. */
export function isDependabotRequest(body: string): boolean {
  const trimmed = body.trimStart();
  return REQUEST_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

async function readJson<T>(
  path: string,
  paginate: boolean,
  call: GhCallOptions,
): Promise<T | null> {
  const argv = paginate ? ['gh', 'api', '--paginate', path] : ['gh', 'api', path];
  const out = await ghCall({ argv }, null, call);
  if (out === null) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

function prState(pull: RawPull): PrState {
  if (pull.state === 'open') return 'open';
  return pull.merged || pull.merged_at ? 'merged' : 'closed';
}

function latest(timestamps: string[]): string {
  return timestamps.reduce((max, t) => (t > max ? t : max), '');
}

/**
 * Read one PR's Dependabot lifecycle snapshot. Returns `null` when any read
 * fails. Reactions are fetched only for the latest request comment.
 */
export async function readDependabotSnapshot(
  repo: string,
  prNumber: number,
  call: GhCallOptions = {},
): Promise<DependabotSnapshot | null> {
  const pull = await readJson<RawPull>(`repos/${repo}/pulls/${prNumber}`, false, call);
  if (pull === null) return null;
  const state = prState(pull);
  const rebaseMarker = bodyRebaseMarker(pull.body ?? '');
  if (state !== 'open') {
    return { state, rebaseMarker, request: null, lastBotCommitAt: '', lastBotCommentAt: '' };
  }

  const comments = await readJson<RawComment[]>(
    `repos/${repo}/issues/${prNumber}/comments`,
    true,
    call,
  );
  const commits = await readJson<RawCommit[]>(
    `repos/${repo}/pulls/${prNumber}/commits`,
    true,
    call,
  );
  if (comments === null || commits === null) return null;

  // The comments endpoint returns comments oldest-first, so the last match is the latest.
  const requestComment = comments.filter((c) => isDependabotRequest(c.body ?? '')).at(-1);

  let request: DependabotRequest | null = null;
  if (requestComment) {
    const reactions = await readJson<RawReaction[]>(
      `repos/${repo}/issues/comments/${requestComment.id}/reactions`,
      true,
      call,
    );
    if (reactions === null) return null;
    request = {
      commentId: requestComment.id,
      createdAt: requestComment.created_at,
      acknowledged: reactions.some((r) => r.user?.login === DEPENDABOT_LOGIN),
    };
  }

  return {
    state,
    rebaseMarker,
    request,
    lastBotCommitAt: latest(
      commits
        .filter((c) => c.author?.login === DEPENDABOT_LOGIN)
        .map((c) => c.commit.committer?.date ?? ''),
    ),
    lastBotCommentAt: latest(
      comments.filter((c) => c.user?.login === DEPENDABOT_LOGIN).map((c) => c.created_at),
    ),
  };
}
