import type { GhCallOptions, Sleeper } from './gh-call.js';
import { readMergeSafetySnapshot, type MergeSafetySnapshot } from './merge-safety-state.js';
import { classifyMergeSafety, type MergeSafetyVerdict } from './merge-safety-verdict.js';
import { CONSECUTIVE_FAILURE_LIMIT } from './wait-for-dependabot.js';

/**
 * Wait until a PR's `merge-safety` check reaches a final state on its current head
 * commit, then report it. Every way the wait can end is bounded and distinct:
 *
 * - `passed` / `failed` / `blocked` / `merged` / `closed` — see
 *   {@link classifyMergeSafety}. `blocked` (`Update required`) ends the wait at once
 *   instead of waiting forever on a check that will not re-run until the branch is
 *   updated.
 * - `no-verdict` — the current head went the whole no-verdict grace without a final
 *   verdict: nothing posted (a cancelled first evaluation posts none, and a repo that
 *   does not run merge-safety never will), or a `Re-evaluating` mark whose evaluation
 *   never came. The grace restarts whenever the head moves, since the new head needs
 *   its own evaluation.
 * - `timeout` — the overall timeout passed first (the head kept moving).
 * - `error` — {@link CONSECUTIVE_FAILURE_LIMIT} reads in a row failed.
 *
 * `previousHead` covers a caller that has just updated the branch: GitHub applies
 * an update (and Dependabot a rebase) asynchronously, so the PR can still show the
 * old head and its old `Update required` for a while. While the head is still
 * `previousHead`, a `blocked`, `failed` or pending verdict reads as "update not
 * landed yet"; a `passed` one still counts, since the update had nothing to do.
 */

export type MergeSafetyOutcome = MergeSafetyVerdict['status'] | 'no-verdict' | 'timeout' | 'error';

export type MergeSafetyFinalOutcome = Exclude<MergeSafetyOutcome, 'waiting'>;

export interface MergeSafetyWaitResult {
  outcome: MergeSafetyFinalOutcome;
  reason: string;
  /** The head commit the outcome is for, or `null` if it was never read. */
  headSha: string | null;
  elapsedSeconds: number;
}

export interface WaitForMergeSafetyOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** How long one head may go without a final verdict before the wait ends `no-verdict`. */
  noVerdictGraceMs?: number;
  /** The head (full or abbreviated SHA) before a branch update the caller just made; its verdict never counts. */
  previousHead?: string;
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

/** Classify a snapshot, holding a head the caller has already moved past at `waiting`. */
function verdictFor(snapshot: MergeSafetySnapshot, previousHead?: string): MergeSafetyVerdict {
  const verdict = classifyMergeSafety(snapshot);
  // Only a verdict the update could change is held: `passed` on the old head means
  // the update had nothing to do, and a merged or closed PR is final either way.
  const holdable =
    verdict.status === 'blocked' || verdict.status === 'failed' || verdict.status === 'waiting';
  if (holdable && previousHead && snapshot.headSha.startsWith(previousHead)) {
    return {
      status: 'waiting',
      reason: `head is still ${previousHead.slice(0, 7)}; waiting for the branch update to land`,
    };
  }
  return verdict;
}

export async function waitForMergeSafety(
  repo: string,
  pr: number,
  opts: WaitForMergeSafetyOptions = {},
): Promise<MergeSafetyWaitResult> {
  const {
    intervalMs = DEFAULT_MERGE_SAFETY_INTERVAL_MS,
    timeoutMs = DEFAULT_MERGE_SAFETY_TIMEOUT_MS,
    noVerdictGraceMs = DEFAULT_NO_VERDICT_GRACE_MS,
    previousHead,
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
  const end = (outcome: MergeSafetyFinalOutcome): MergeSafetyWaitResult => ({
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
      const verdict = verdictFor(snapshot, previousHead);
      const changed = verdict.reason !== reason;
      reason = verdict.reason;
      if (verdict.status !== 'waiting') return end(verdict.status);
      if (changed) onUpdate?.(reason);
      if (now() - headSince >= noVerdictGraceMs) {
        reason = `${reason}; no final verdict after ${Math.round(noVerdictGraceMs / 1000)}s on this head`;
        return end('no-verdict');
      }
    }
    if (now() - start >= timeoutMs) return end('timeout');
    await sleep(intervalMs);
  }
}
