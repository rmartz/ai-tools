import { boundedRun } from '@rmartz/agent-runtime';
import type { GhCallOptions } from './gh-call.js';

/**
 * Resolve and dismiss PR review threads (review *craft*). GraphQL-only — thread
 * resolution has no REST equivalent. TS port of dotfiles' `resolve_thread.py` +
 * `dismiss_thread.py`.
 *
 * `dismissThread` enforces the **reply-before-resolve** policy: a thread the
 * author decides not to act on must carry a visible reply explaining why, so the
 * reviewer knows it was seen and intentionally closed. These calls are single-shot
 * (no retry) — matching the Python — so a non-idempotent reply POST is never
 * silently duplicated by a retry.
 */

const GH_TIMEOUT_MS = 30_000;

const RESOLVE_MUTATION =
  'mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }';

const LOOKUP_QUERY =
  'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { ' +
  'comments(first: 1) { nodes { databaseId } } ' +
  'pullRequest { number repository { nameWithOwner } } } } }';

export type DismissResult = 'ok' | 'reply_only' | 'failed';

interface ThreadInfo {
  prNumber: number;
  repo: string;
  commentDbId: number;
}

async function ghText(argv: string[], opts: GhCallOptions): Promise<string | null> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) return null;
  try {
    const r = await boundedRun(cmd, rest, { timeoutMs: GH_TIMEOUT_MS, cwd: opts.cwd });
    return r.code === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

async function ghJson<T>(argv: string[], opts: GhCallOptions): Promise<T | null> {
  const out = await ghText(argv, opts);
  if (out === null) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

interface ResolveResponse {
  data?: { resolveReviewThread?: { thread?: { isResolved?: boolean } } };
}

/** Resolve a review thread by its `PRRT_` node ID. Returns whether it is resolved. */
export async function resolveThread(threadId: string, opts: GhCallOptions = {}): Promise<boolean> {
  const data = await ghJson<ResolveResponse>(
    ['gh', 'api', 'graphql', '-f', `query=${RESOLVE_MUTATION}`, '-f', `id=${threadId}`],
    opts,
  );
  return data?.data?.resolveReviewThread?.thread?.isResolved === true;
}

interface LookupResponse {
  data?: {
    node?: {
      comments?: { nodes?: { databaseId?: number }[] };
      pullRequest?: { number?: number; repository?: { nameWithOwner?: string } };
    } | null;
  };
}

async function lookupThread(threadId: string, opts: GhCallOptions): Promise<ThreadInfo | null> {
  const data = await ghJson<LookupResponse>(
    ['gh', 'api', 'graphql', '-f', `query=${LOOKUP_QUERY}`, '-f', `id=${threadId}`],
    opts,
  );
  const node = data?.data?.node;
  if (!node) return null;
  const prNumber = node.pullRequest?.number;
  const repo = node.pullRequest?.repository?.nameWithOwner;
  const commentDbId = node.comments?.nodes?.[0]?.databaseId;
  if (prNumber === undefined || repo === undefined || commentDbId === undefined) return null;
  return { prNumber, repo, commentDbId };
}

async function postReply(info: ThreadInfo, body: string, opts: GhCallOptions): Promise<boolean> {
  const out = await ghText(
    [
      'gh',
      'api',
      `repos/${info.repo}/pulls/${info.prNumber}/comments/${info.commentDbId}/replies`,
      '-X',
      'POST',
      '-f',
      `body=${body}`,
    ],
    opts,
  );
  return out !== null;
}

/**
 * Post a reply to a review thread, then resolve it. Returns `'ok'` when both
 * succeed, `'reply_only'` when the reply posted but the resolve failed (the
 * thread stays open — call `resolveThread` to finish without re-posting), or
 * `'failed'` when the lookup or reply failed (resolve is skipped).
 */
export async function dismissThread(
  threadId: string,
  replyBody: string,
  opts: GhCallOptions = {},
): Promise<DismissResult> {
  const info = await lookupThread(threadId, opts);
  if (info === null) return 'failed';
  if (!(await postReply(info, replyBody, opts))) return 'failed';
  return (await resolveThread(threadId, opts)) ? 'ok' : 'reply_only';
}
