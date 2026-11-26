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

export type DependabotCommand = 'rebase' | 'recreate';

/** Dependabot's own PR-body status line while it works on the branch. */
export type RebaseMarker = 'in_progress' | 'failed' | 'none';

export type PrState = 'open' | 'closed' | 'merged';

export interface DependabotRequest {
  commentId: number;
  createdAt: string;
  /** True once `dependabot[bot]` reacted to the request comment (it acks with 👍). */
  acknowledged: boolean;
}

/** One `@dependabot rebase|recreate` comment and when Dependabot reacted to it. */
export interface DependabotCommandComment {
  commentId: number;
  command: DependabotCommand;
  createdAt: string;
  /** When `dependabot[bot]` reacted, or `null`. Only the newest request's reactions are read. */
  acknowledgedAt: string | null;
}

/** A comment `dependabot[bot]` posted on the PR. */
export interface DependabotComment {
  createdAt: string;
  body: string;
}

/** The Dependabot-related timeline of an open PR, from one read. */
export interface DependabotActivity {
  /** Every request comment, oldest first. */
  requests: DependabotCommandComment[];
  /** Comments `dependabot[bot]` posted, oldest first. */
  replies: DependabotComment[];
  /** ISO timestamp of the latest `dependabot[bot]` commit, or `''`. */
  lastBotCommitAt: string;
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

export interface RawPull {
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
  created_at: string;
}

/** Classify a Dependabot PR body's rebase-status line. */
export function bodyRebaseMarker(body: string): RebaseMarker {
  if (/Dependabot rebase failed/i.test(body)) return 'failed';
  if (/Dependabot is rebasing this PR/i.test(body)) return 'in_progress';
  return 'none';
}

/** The command a comment body issues, or `null` when it is not a Dependabot command. */
export function parseDependabotCommand(body: string): DependabotCommand | null {
  const m = body.trimStart().match(/^@dependabot (rebase|recreate)\b/);
  return m ? (m[1] as DependabotCommand) : null;
}

/** True when a comment body is a `@dependabot rebase` / `recreate` command. */
export function isDependabotRequest(body: string): boolean {
  return parseDependabotCommand(body) !== null;
}

export async function readJson<T>(
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

export function prState(pull: RawPull): PrState {
  if (pull.state === 'open') return 'open';
  return pull.merged || pull.merged_at ? 'merged' : 'closed';
}

function latest(timestamps: string[]): string {
  return timestamps.reduce((max, t) => (t > max ? t : max), '');
}

/**
 * Read the Dependabot timeline of one open PR: its request comments, Dependabot's
 * replies, and its last commit. Returns `null` when any read fails. Reactions are
 * fetched only for the newest request, the one callers classify.
 */
export async function readDependabotActivity(
  repo: string,
  prNumber: number,
  call: GhCallOptions = {},
): Promise<DependabotActivity | null> {
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

  // The comments endpoint returns comments oldest-first.
  const requests: DependabotCommandComment[] = comments.flatMap((c) => {
    const command = parseDependabotCommand(c.body ?? '');
    return command && c.user?.login !== DEPENDABOT_LOGIN
      ? [{ commentId: c.id, command, createdAt: c.created_at, acknowledgedAt: null }]
      : [];
  });
  const newest = requests.at(-1);
  if (newest) {
    const reactions = await readJson<RawReaction[]>(
      `repos/${repo}/issues/comments/${newest.commentId}/reactions`,
      true,
      call,
    );
    if (reactions === null) return null;
    newest.acknowledgedAt =
      reactions.find((r) => r.user?.login === DEPENDABOT_LOGIN)?.created_at ?? null;
  }

  return {
    requests,
    replies: comments
      .filter((c) => c.user?.login === DEPENDABOT_LOGIN)
      .map((c) => ({ createdAt: c.created_at, body: c.body ?? '' })),
    lastBotCommitAt: latest(
      commits
        .filter((c) => c.author?.login === DEPENDABOT_LOGIN)
        .map((c) => c.commit.committer?.date ?? ''),
    ),
  };
}

/**
 * Read one PR's Dependabot lifecycle snapshot. Returns `null` when any read
 * fails.
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

  const activity = await readDependabotActivity(repo, prNumber, call);
  if (activity === null) return null;
  const newest = activity.requests.at(-1);
  const request: DependabotRequest | null = newest
    ? {
        commentId: newest.commentId,
        createdAt: newest.createdAt,
        acknowledged: newest.acknowledgedAt !== null,
      }
    : null;
  return {
    state,
    rebaseMarker,
    request,
    lastBotCommitAt: activity.lastBotCommitAt,
    lastBotCommentAt: latest(activity.replies.map((r) => r.createdAt)),
  };
}
