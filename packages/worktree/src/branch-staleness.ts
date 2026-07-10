import { boundedRun } from '@rmartz/agent-runtime';

/**
 * Branch staleness detection for `ai-git-cleanup`. A branch whose latest commit
 * is at least `STALE_AFTER_DAYS` old is treated as abandoned: if we were waiting
 * on its PR, after this long we are not coming back to it, and a no-PR branch
 * that never resolves is otherwise never cleaned up at all.
 */

const GIT_TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;

/** Default staleness threshold — a branch idle this many days is cleanup-eligible. */
export const STALE_AFTER_DAYS = 30;

/**
 * Whether a branch's latest-commit epoch (ms), or `null` when the age could not
 * be determined, is at least `days` old relative to `nowMs`. Unknown age is
 * **never** stale — the conservative answer that keeps a branch it cannot
 * confirm abandoned.
 */
export function isStale(commitEpochMs: number | null, nowMs: number, days: number): boolean {
  if (commitEpochMs === null) return false;
  return nowMs - commitEpochMs >= days * DAY_MS;
}

/**
 * Latest commit's committer date (epoch ms) for `branch`, or `null` if it can't
 * be read (git failure / unparseable) — which callers treat as "not stale".
 */
export async function branchCommitEpochMs(
  branch: string,
  cwd: string | undefined,
): Promise<number | null> {
  try {
    const r = await boundedRun('git', ['log', '-1', '--format=%ct', branch], {
      timeoutMs: GIT_TIMEOUT_MS,
      cwd,
    });
    if ((r.code ?? 1) !== 0) return null;
    const seconds = Number.parseInt(r.stdout.trim(), 10);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/** The subset of `branches` whose latest commit is at least `days` old at `nowMs`. */
export async function classifyStaleBranches(
  branches: Iterable<string>,
  cwd: string | undefined,
  nowMs: number,
  days: number,
): Promise<Set<string>> {
  const stale = new Set<string>();
  for (const branch of branches) {
    if (isStale(await branchCommitEpochMs(branch, cwd), nowMs, days)) stale.add(branch);
  }
  return stale;
}
