import type { GhCallOptions, Sleeper } from './gh-call.js';
import { readMergeSafetySnapshot, type MergeSafetySnapshot } from './merge-safety-state.js';
import { classifyMergeSafety } from './merge-safety-verdict.js';
import { CONSECUTIVE_FAILURE_LIMIT } from './wait-for-dependabot.js';

/**
 * Wait until a PR's `merge-safety` check reaches a final state on its current head
 * commit, then report it. Every way the wait can end is bounded and distinct:
 *
 * - `passed` / `failed` / `blocked` / `closed` — see {@link classifyMergeSafety}.
 *   `blocked` (`Update required`) ends the wait at once instead of waiting forever
 *   on a check that will not re-run until the branch is updated.
 * - `no-verdict` — nothing was posted on the current head within the no-verdict
 *   grace. A cancelled first evaluation posts no verdict at all, and a repo that
 *   does not run merge-safety never will. The grace restarts whenever the head
 *   moves (a rebase or push), since the new head needs its own evaluation.
 * - `timeout` — a verdict is still pending (`Re-evaluating`) at the overall timeout.
 * - `error` — {@link CONSECUTIVE_FAILURE_LIMIT} reads in a row failed.
 */

export type MergeSafetyOutcome =
  'passed' | 'failed' | 'blocked' | 'closed' | 'no-verdict' | 'timeout' | 'error';

export interface MergeSafetyWaitResult {
  outcome: MergeSafetyOutcome;
  reason: string;
  /** The head commit the outcome is for, or `null` if it was never read. */
  headSha: string | null;
  elapsedSeconds: number;
}

export interface WaitForMergeSafetyOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** How long the current head may go with no verdict before the wait ends `no-verdict`. */
  noVerdictGraceMs?: number;
  /** Called when the waiting reason changes (a new head, a pending title), for progress. */
  onUpdate?: (reason: string) => void;
  /** Injectable clock and sleeper for tests. */
  now?: () => number;
  sleep?: Sleeper;
  /** Injectable snapshot reader for tests; defaults to {@link readMergeSafetySnapshot}. */
  read?: (repo: string, pr: number, call: GhCallOptions) => Promise<MergeSafetySnapshot | null>;
  call?: GhCallOptions;
}

export const DEFAULT_MERGE_SAFETY_INTERVAL_MS = 20_000;
export const DEFAULT_MERGE_SAFETY_TIMEOUT_MS = 1_800_000;
/** The merge-safety job times out after 5 minutes; allow for the Actions queue too. */
export const DEFAULT_NO_VERDICT_GRACE_MS = 600_000;

const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForMergeSafety(
  repo: string,
  pr: number,
  opts: WaitForMergeSafetyOptions = {},
): Promise<MergeSafetyWaitResult> {
  const {
    intervalMs = DEFAULT_MERGE_SAFETY_INTERVAL_MS,
    timeoutMs = DEFAULT_MERGE_SAFETY_TIMEOUT_MS,
    noVerdictGraceMs = DEFAULT_NO_VERDICT_GRACE_MS,
    onUpdate,
    now = Date.now,
    sleep = realSleep,
    read = readMergeSafetySnapshot,
    call = {},
  } = opts;
  const start = now();
  const elapsed = (): number => Math.round((now() - start) / 1000);
  let headSha: string | null = null;
  let headSince = start;
  let reason = 'merge-safety not read yet';
  let failures = 0;
  const end = (outcome: MergeSafetyOutcome): MergeSafetyWaitResult => ({
    outcome,
    reason,
    headSha,
    elapsedSeconds: elapsed(),
  });

  for (;;) {
    const snapshot = await read(repo, pr, call);
    if (snapshot === null) {
      failures += 1;
      if (failures >= CONSECUTIVE_FAILURE_LIMIT) {
        reason = `could not read PR #${pr} in ${repo} ${failures} times in a row`;
        return end('error');
      }
    } else {
      failures = 0;
      if (snapshot.headSha !== headSha) {
        headSha = snapshot.headSha;
        headSince = now();
      }
      const verdict = classifyMergeSafety(snapshot);
      const changed = verdict.reason !== reason;
      reason = verdict.reason;
      if (verdict.status !== 'waiting') return end(verdict.status);
      if (changed) onUpdate?.(reason);
      if (snapshot.report === null && now() - headSince >= noVerdictGraceMs) {
        reason = `${reason} after ${Math.round(noVerdictGraceMs / 1000)}s (no evaluation ran, or it was cancelled)`;
        return end('no-verdict');
      }
    }
    if (now() - start >= timeoutMs) return end('timeout');
    await sleep(intervalMs);
  }
}
