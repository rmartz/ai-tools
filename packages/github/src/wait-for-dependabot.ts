import type { GhCallOptions, Sleeper } from './gh-call.js';
import { classifyDependabotResponse } from './dependabot-response.js';
import { readDependabotSnapshot, type DependabotSnapshot } from './dependabot-state.js';

/**
 * Wait for Dependabot to answer a `@dependabot rebase` / `recreate` request, or
 * to finish a rebase it started on its own, on one or more PRs. TS port of
 * dotfiles' `wait-for-dependabot.py`, adding **missed-request detection**: a
 * request Dependabot never acknowledged (no reaction) within the ack grace
 * period ends the wait as `missed` instead of running out the full timeout.
 *
 * Timestamps are compared against the latest request on the PR, so the caller
 * records nothing up front and a response that landed before the wait started
 * still counts.
 */

export type WaitOutcome = 'answered' | 'missed' | 'timeout' | 'error';

export interface PrOutcome {
  pr: number;
  status: 'answered' | 'missed';
  reason: string;
  elapsedSeconds: number;
}

export interface WaitResult {
  outcome: WaitOutcome;
  /** Per-PR terminal outcomes, in the order they resolved. */
  resolved: PrOutcome[];
  /** PRs still unresolved when the wait ended. */
  pending: number[];
  elapsedSeconds: number;
}

/** Consecutive polls with a failed read before the wait gives up with `error`. */
export const CONSECUTIVE_FAILURE_LIMIT = 5;

export interface WaitForDependabotOptions {
  /** Wait for every PR to resolve instead of the first one. */
  all?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  ackGraceMs?: number;
  /** Called as each PR resolves, so a CLI can stream progress. */
  onResolved?: (outcome: PrOutcome) => void;
  /** Injectable clock and sleeper for tests. */
  now?: () => number;
  sleep?: Sleeper;
  /** Injectable snapshot reader for tests; defaults to {@link readDependabotSnapshot}. */
  read?: (repo: string, pr: number, call: GhCallOptions) => Promise<DependabotSnapshot | null>;
  call?: GhCallOptions;
}

const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `missed` wins over `answered`: any dropped request needs the caller's attention. */
function overallOutcome(resolved: PrOutcome[]): WaitOutcome {
  return resolved.some((r) => r.status === 'missed') ? 'missed' : 'answered';
}

export async function waitForDependabot(
  repo: string,
  prs: number[],
  opts: WaitForDependabotOptions = {},
): Promise<WaitResult> {
  const {
    all = false,
    intervalMs = 30_000,
    timeoutMs = 3_600_000,
    ackGraceMs,
    onResolved,
    now = Date.now,
    sleep = realSleep,
    read = readDependabotSnapshot,
    call = {},
  } = opts;
  const start = now();
  const elapsed = (): number => Math.round((now() - start) / 1000);
  const waiting = [...prs];
  const resolved: PrOutcome[] = [];
  let failures = 0;

  for (;;) {
    let failed = false;
    for (const pr of [...waiting]) {
      const snapshot = await read(repo, pr, call);
      if (snapshot === null) {
        failed = true;
        continue;
      }
      const response = classifyDependabotResponse(snapshot, { now: now(), ackGraceMs });
      if (response.status === 'pending') continue;
      const outcome = {
        pr,
        status: response.status,
        reason: response.reason,
        elapsedSeconds: elapsed(),
      };
      resolved.push(outcome);
      onResolved?.(outcome);
      waiting.splice(waiting.indexOf(pr), 1);
      if (!all) {
        return { outcome: response.status, resolved, pending: waiting, elapsedSeconds: elapsed() };
      }
    }
    if (waiting.length === 0) {
      return {
        outcome: overallOutcome(resolved),
        resolved,
        pending: [],
        elapsedSeconds: elapsed(),
      };
    }
    failures = failed ? failures + 1 : 0;
    if (failures >= CONSECUTIVE_FAILURE_LIMIT) {
      return { outcome: 'error', resolved, pending: waiting, elapsedSeconds: elapsed() };
    }
    if (now() - start >= timeoutMs) {
      return { outcome: 'timeout', resolved, pending: waiting, elapsedSeconds: elapsed() };
    }
    await sleep(intervalMs);
  }
}
