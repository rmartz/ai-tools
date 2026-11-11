import { ghCall, type GhCallOptions } from './gh-call.js';
import type { DependabotTimeline } from './dependabot-refresh.js';
import {
  prState,
  readDependabotActivity,
  readJson,
  type PrState,
  type RawPull,
} from './dependabot-state.js';

/**
 * The GitHub reads behind `refreshPr`: the PR's freshness against its base, and
 * the Dependabot timeline the state machine classifies. Soft-fail to `null` like
 * the rest of the client, so the caller can report a failed read rather than act
 * on partial state.
 */

export interface PrRefreshState {
  state: PrState;
  author: string;
  body: string;
  headSha: string;
  baseRef: string;
  /** `false` when GitHub reports a merge conflict; `null` while it is still computing. */
  mergeable: boolean | null;
}

interface RawRefreshPull extends RawPull {
  user: { login: string } | null;
  head: { sha: string };
  base: { ref: string };
  mergeable: boolean | null;
}

/** Read the PR fields `refreshPr` needs, or `null` on failure. */
export async function readPrRefreshState(
  repo: string,
  pr: string,
  call: GhCallOptions = {},
): Promise<PrRefreshState | null> {
  const raw = await readJson<RawRefreshPull>(`repos/${repo}/pulls/${pr}`, false, call);
  if (!raw?.head?.sha || !raw.base?.ref) return null;
  return {
    state: prState(raw),
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

/**
 * Assemble the {@link DependabotTimeline} for a PR from the shared Dependabot
 * activity read. Returns `null` when that read fails.
 */
export async function readDependabotTimeline(
  repo: string,
  pr: string,
  body: string,
  call: GhCallOptions = {},
): Promise<DependabotTimeline | null> {
  const activity = await readDependabotActivity(repo, Number(pr), call);
  if (activity === null) return null;
  return {
    body,
    requests: activity.requests.map((r) => ({
      command: r.command,
      at: r.createdAt,
      acknowledgedAt: r.acknowledgedAt,
    })),
    replies: activity.replies.map((r) => ({ at: r.createdAt, body: r.body })),
    lastPushAt: activity.lastBotCommitAt || null,
  };
}
