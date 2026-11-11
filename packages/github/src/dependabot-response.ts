import type { DependabotSnapshot } from './dependabot-state.js';

/**
 * Classify how Dependabot has answered a PR's latest rebase/recreate request.
 *
 * - `answered` — it closed/merged the PR, pushed a regenerated branch after the
 *   request, commented after it (usually a refusal), or finished/failed a rebase
 *   it started on its own.
 * - `missed` — the request is older than the ack grace period and Dependabot
 *   never reacted to it. Dependabot acks a command it picks up with a 👍 within
 *   seconds, so no ack means it dropped the request and waiting longer is futile.
 * - `pending` — still waiting (unacknowledged but inside the grace period, or
 *   acknowledged and not yet acted on).
 */
export type DependabotResponse =
  | { status: 'pending' }
  | { status: 'answered'; reason: string }
  | { status: 'missed'; reason: string };

/** Default time Dependabot gets to ack a request before it counts as missed. */
export const DEFAULT_ACK_GRACE_MS = 180_000;

export interface ClassifyOptions {
  /** Current time in epoch ms. */
  now: number;
  /** How long an unacknowledged request may wait before it counts as missed. */
  ackGraceMs?: number;
}

export function classifyDependabotResponse(
  snapshot: DependabotSnapshot,
  { now, ackGraceMs = DEFAULT_ACK_GRACE_MS }: ClassifyOptions,
): DependabotResponse {
  if (snapshot.state !== 'open') {
    return { status: 'answered', reason: `PR is ${snapshot.state}` };
  }
  const { request } = snapshot;
  if (request === null) {
    // Dependabot also rebases on its own (e.g. after the base branch moves),
    // leaving no request comment; its PR body marker is the only signal.
    if (snapshot.rebaseMarker === 'in_progress') return { status: 'pending' };
    if (snapshot.rebaseMarker === 'failed') {
      return { status: 'answered', reason: 'Dependabot rebase failed (see the PR)' };
    }
    return { status: 'answered', reason: 'no rebase/recreate request on record' };
  }
  // ISO-8601 UTC timestamps from the GitHub API compare correctly as strings.
  if (snapshot.lastBotCommitAt > request.createdAt) {
    return { status: 'answered', reason: 'Dependabot pushed a new branch' };
  }
  if (snapshot.lastBotCommentAt > request.createdAt) {
    return { status: 'answered', reason: 'Dependabot commented (likely a refusal; see the PR)' };
  }
  if (request.acknowledged) return { status: 'pending' };
  const waitedMs = now - Date.parse(request.createdAt);
  if (waitedMs >= ackGraceMs) {
    return {
      status: 'missed',
      reason: `Dependabot never acknowledged the request from ${request.createdAt} (no reaction after ${Math.round(waitedMs / 1000)}s)`,
    };
  }
  return { status: 'pending' };
}
