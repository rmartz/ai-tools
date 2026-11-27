import type { MergeSafetySnapshot } from './merge-safety-state.js';

/**
 * Classify a PR's merge-safety snapshot into what a caller should do next.
 *
 * - `passed` — the verdict on the current head is `success` (`No update required`).
 * - `failed` — the verdict is `failure` (`Merge conflict`, `Base CI failing`,
 *   `Could not evaluate`): a branch update alone will not clear it.
 * - `blocked` — the verdict is `Update required`: the branch is behind its base and
 *   merge-safety will not run again until the branch is updated. merge-safety posts
 *   it as an incomplete (`in_progress` / `pending`) check, so it looks like a run in
 *   progress; only the title tells it apart, and waiting on it never ends.
 * - `merged` / `closed` — the PR was merged, or closed without merging.
 * - `waiting` — no verdict on the current head yet, or an incomplete check with any
 *   other title (`Re-evaluating`: a verdict is on its way).
 */
export type MergeSafetyVerdict =
  | { status: 'waiting'; reason: string }
  | { status: 'passed' | 'failed' | 'blocked' | 'merged' | 'closed'; reason: string };

/** The pending title merge-safety posts on a stale-only PR. */
export const UPDATE_REQUIRED_TITLE = 'Update required';

export function classifyMergeSafety(snapshot: MergeSafetySnapshot): MergeSafetyVerdict {
  if (snapshot.state !== 'open')
    return { status: snapshot.state, reason: `PR is ${snapshot.state}` };
  const head = snapshot.headSha.slice(0, 7);
  const { report } = snapshot;
  if (report === null) {
    return { status: 'waiting', reason: `no merge-safety verdict on ${head} yet` };
  }
  const title = report.title.trim();
  const label = title || '(no title)';
  if (report.state === 'success') return { status: 'passed', reason: `${label} on ${head}` };
  if (report.state === 'failure') return { status: 'failed', reason: `${label} on ${head}` };
  if (title.startsWith(UPDATE_REQUIRED_TITLE)) {
    return {
      status: 'blocked',
      reason: `${UPDATE_REQUIRED_TITLE} on ${head}: the branch is behind its base; update it so merge-safety re-evaluates`,
    };
  }
  return { status: 'waiting', reason: `merge-safety pending on ${head} (${label})` };
}
