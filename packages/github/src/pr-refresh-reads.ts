import { ghCall, type GhCallOptions } from './gh-call.js';
import { listIssueComments } from './pr-reads.js';
import {
  DEPENDABOT_LOGIN,
  parseDependabotCommand,
  type DependabotRequest,
  type DependabotTimeline,
} from './dependabot-refresh.js';

/**
 * The GitHub reads behind `refreshPr`: the PR's freshness against its base, and
 * the Dependabot timeline the state machine classifies. Soft-fail to `null` like
 * the rest of the client, so the caller can report a failed read rather than act
 * on partial state.
 */

export interface PrRefreshState {
  state: 'open' | 'closed' | 'merged';
  author: string;
  body: string;
  headSha: string;
  baseRef: string;
  /** `false` when GitHub reports a merge conflict; `null` while it is still computing. */
  mergeable: boolean | null;
}

interface RawPull {
  state: string;
  merged: boolean;
  user: { login: string } | null;
  body: string | null;
  head: { sha: string };
  base: { ref: string };
  mergeable: boolean | null;
}

async function readJson(argv: string[], call: GhCallOptions): Promise<unknown> {
  const out = await ghCall({ argv }, null, call);
  if (out === null) return null;
  try {
    return JSON.parse(out) as unknown;
  } catch {
    return null;
  }
}

/** Read the PR fields `refreshPr` needs, or `null` on failure. */
export async function readPrRefreshState(
  repo: string,
  pr: string,
  call: GhCallOptions = {},
): Promise<PrRefreshState | null> {
  const raw = (await readJson(['gh', 'api', `repos/${repo}/pulls/${pr}`], call)) as RawPull | null;
  if (!raw?.head?.sha || !raw.base?.ref) return null;
  return {
    state: raw.merged ? 'merged' : raw.state === 'open' ? 'open' : 'closed',
    author: raw.user?.login ?? '',
    body: raw.body ?? '',
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    mergeable: raw.mergeable,
  };
}

/** Commits `headSha` is behind `baseRef`, or `null` on failure. */
export async function readBehindBy(
  repo: string,
  baseRef: string,
  headSha: string,
  call: GhCallOptions = {},
): Promise<number | null> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        `repos/${repo}/compare/${encodeURIComponent(baseRef)}...${headSha}`,
        '--jq',
        '.behind_by',
      ],
    },
    null,
    call,
  );
  const n = Number(out?.trim());
  return out !== null && Number.isInteger(n) ? n : null;
}

interface RawCommit {
  author: { login: string } | null;
  commit: { committer: { date: string } | null };
}

interface RawReaction {
  content: string;
  user: { login: string } | null;
  created_at: string;
}

async function lastDependabotPushAt(
  repo: string,
  pr: string,
  call: GhCallOptions,
): Promise<string | null | undefined> {
  const commits = (await readJson(
    ['gh', 'api', '--paginate', `repos/${repo}/pulls/${pr}/commits`],
    call,
  )) as RawCommit[] | null;
  if (!Array.isArray(commits)) return undefined;
  const dates = commits
    .filter((c) => c.author?.login === DEPENDABOT_LOGIN)
    .map((c) => c.commit.committer?.date ?? '')
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

/** When Dependabot 👍-reacted to a request comment, or `null` if it has not. */
async function acknowledgedAt(
  repo: string,
  commentId: number,
  call: GhCallOptions,
): Promise<string | null> {
  const reactions = (await readJson(
    ['gh', 'api', `repos/${repo}/issues/comments/${commentId}/reactions`],
    call,
  )) as RawReaction[] | null;
  if (!Array.isArray(reactions)) return null;
  const ack = reactions.find((r) => r.user?.login === DEPENDABOT_LOGIN && r.content === '+1');
  return ack?.created_at ?? null;
}

/**
 * Assemble the {@link DependabotTimeline} for a PR. Only the newest request's
 * reactions are fetched — the state machine reads the acknowledgement of that one
 * request alone. Returns `null` when the commits cannot be read.
 */
export async function readDependabotTimeline(
  repo: string,
  pr: string,
  body: string,
  call: GhCallOptions = {},
): Promise<DependabotTimeline | null> {
  const lastPushAt = await lastDependabotPushAt(repo, pr, call);
  if (lastPushAt === undefined) return null;
  const comments = await listIssueComments(repo, Number(pr), call);
  const requestComments = comments.flatMap((c) => {
    const command = parseDependabotCommand(c.body);
    return command && c.author !== DEPENDABOT_LOGIN ? [{ command, at: c.createdAt, id: c.id }] : [];
  });
  const newest = [...requestComments].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const ackOfNewest = newest ? await acknowledgedAt(repo, newest.id, call) : null;
  const requests: DependabotRequest[] = requestComments.map((c) => ({
    command: c.command,
    at: c.at,
    acknowledgedAt: c === newest ? ackOfNewest : null,
  }));
  const replies = comments
    .filter((c) => c.author === DEPENDABOT_LOGIN)
    .map((c) => ({ at: c.createdAt, body: c.body }));
  return { body, requests, replies, lastPushAt };
}
