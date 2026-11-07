/**
 * The Dependabot rebase/recreate state machine, as a pure function over a PR's
 * timeline. Dependabot owns its branches, so the only way to bring one current is
 * a `@dependabot rebase` / `@dependabot recreate` comment — and Dependabot answers
 * asynchronously: it 👍-reacts to acknowledge a command, then force-pushes a fresh
 * branch, closes the PR, or replies with a refusal. This module decides, from that
 * history alone, whether to post a command, wait, or give up. It stores nothing:
 * every caller that reads the same timeline reaches the same decision.
 *
 * The response patterns are a TS port of dotfiles' `lib/dependabot_state.py`.
 */

export const DEPENDABOT_LOGIN = 'dependabot[bot]';

export type DependabotCommand = 'rebase' | 'recreate';

/** A `@dependabot rebase|recreate` request comment, with Dependabot's 👍 acknowledgement time. */
export interface DependabotRequest {
  command: DependabotCommand;
  at: string;
  acknowledgedAt: string | null;
}

/** A comment Dependabot itself posted on the PR. */
export interface DependabotReply {
  at: string;
  body: string;
}

/** Everything the state machine reads. Timestamps are ISO-8601 UTC strings. */
export interface DependabotTimeline {
  body: string;
  requests: DependabotRequest[];
  replies: DependabotReply[];
  /** Committer date of the newest `dependabot[bot]` commit — the last force-push. */
  lastPushAt: string | null;
}

export interface DependabotRefreshPolicy {
  /** Minutes to wait on a request Dependabot has not acknowledged before re-posting it. */
  pendingMinutes: number;
  /** Minutes to wait after Dependabot acknowledged a request before re-posting it. */
  acknowledgedPendingMinutes: number;
  /** Posts of one command per cycle before giving up and escalating. */
  maxAttempts: number;
}

export const DEFAULT_DEPENDABOT_REFRESH_POLICY: DependabotRefreshPolicy = {
  pendingMinutes: 10,
  acknowledgedPendingMinutes: 30,
  maxAttempts: 3,
};

export type DependabotDecision =
  | { action: 'post'; command: DependabotCommand; reason: string }
  | { action: 'wait'; reason: string }
  | { action: 'escalate'; reason: string };

const REFUSAL_PATTERNS = ['edited by someone other than Dependabot', 'already up-to-date with'];

export type RebaseMarker = 'in-progress' | 'failed' | null;

/** Classify the rebase-status line Dependabot writes into its own PR body. */
export function bodyRebaseMarker(body: string): RebaseMarker {
  if (/Dependabot rebase failed/i.test(body)) return 'failed';
  if (/Dependabot is rebasing this PR/i.test(body)) return 'in-progress';
  return null;
}

/** The command a comment body issues, or `null` when it is not a Dependabot command. */
export function parseDependabotCommand(body: string): DependabotCommand | null {
  const m = body.trimStart().match(/^@dependabot (rebase|recreate)\b/);
  return m ? (m[1] as DependabotCommand) : null;
}

/** True when a Dependabot reply refuses a rebase in a way only a recreate clears. */
export function isRebaseRefusal(body: string): boolean {
  return REFUSAL_PATTERNS.some((p) => body.includes(p));
}

function firstLine(body: string): string {
  return body.trim().split('\n')[0] ?? '';
}

/** Escalate a refused/failed command, or step a refused `rebase` up to `recreate`. */
function afterRejection(command: DependabotCommand, why: string): DependabotDecision {
  if (command === 'rebase') {
    return { action: 'post', command: 'recreate', reason: `rebase was rejected (${why})` };
  }
  return { action: 'escalate', reason: `recreate was rejected (${why})` };
}

/**
 * Decide the next step for a Dependabot PR whose branch needs updating. A "cycle"
 * is everything since Dependabot's last force-push: requests before that push were
 * answered by it, so only newer ones count.
 */
export function decideDependabotRefresh(
  timeline: DependabotTimeline,
  now: Date,
  policy: DependabotRefreshPolicy = DEFAULT_DEPENDABOT_REFRESH_POLICY,
): DependabotDecision {
  const since = timeline.lastPushAt ?? '';
  const cycle = timeline.requests
    .filter((r) => r.at > since)
    .sort((a, b) => a.at.localeCompare(b.at));
  const latest = cycle.at(-1);
  const marker = bodyRebaseMarker(timeline.body);

  if (marker === 'in-progress') return { action: 'wait', reason: 'Dependabot is rebasing this PR' };
  if (!latest)
    return { action: 'post', command: 'rebase', reason: 'no request since the last push' };

  const reply = timeline.replies.find((r) => r.at > latest.at);
  if (reply) {
    if (isRebaseRefusal(reply.body)) return afterRejection(latest.command, firstLine(reply.body));
    return { action: 'escalate', reason: `Dependabot replied: ${firstLine(reply.body)}` };
  }
  if (marker === 'failed') return afterRejection(latest.command, 'Dependabot rebase failed');

  const waitFrom = latest.acknowledgedAt ?? latest.at;
  const windowMinutes = latest.acknowledgedAt
    ? policy.acknowledgedPendingMinutes
    : policy.pendingMinutes;
  const elapsedMinutes = (now.getTime() - Date.parse(waitFrom)) / 60_000;
  if (elapsedMinutes < windowMinutes) {
    const state = latest.acknowledgedAt ? 'acknowledged' : 'not yet acknowledged';
    return { action: 'wait', reason: `${latest.command} request ${state}` };
  }

  const attempts = cycle.filter((r) => r.command === latest.command).length;
  if (attempts >= policy.maxAttempts) {
    return {
      action: 'escalate',
      reason: `${latest.command} posted ${attempts} times with no response`,
    };
  }
  return {
    action: 'post',
    command: latest.command,
    reason: `no response to ${latest.command} after ${Math.floor(elapsedMinutes)} minutes`,
  };
}
