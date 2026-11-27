import { describe, it, expect } from 'vitest';
import { waitForMergeSafety } from '../src/wait-for-merge-safety.js';
import type { MergeSafetyReport, MergeSafetySnapshot } from '../src/merge-safety-state.js';

const START = Date.parse('2026-11-26T12:00:00Z');

function makeSnapshot(
  report: MergeSafetyReport | null,
  over: Partial<MergeSafetySnapshot> = {},
): MergeSafetySnapshot {
  return { state: 'open', headSha: 'head-a', report, ...over };
}

const pending = (title: string): MergeSafetyReport => ({
  source: 'status',
  state: 'pending',
  title,
});
const success: MergeSafetyReport = {
  source: 'status',
  state: 'success',
  title: 'No update required',
};

/** A fake clock advanced only by the injected sleeper, so polls are instant. */
function makeClock() {
  let t = START;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

type Reader = () => Promise<MergeSafetySnapshot | null>;

/** A reader that returns each snapshot in turn, then repeats the last one. */
function sequence(...snapshots: (MergeSafetySnapshot | null)[]): Reader {
  let i = 0;
  return async () => snapshots[Math.min(i++, snapshots.length - 1)] ?? null;
}

const fast = { intervalMs: 30_000 };

describe('waitForMergeSafety', () => {
  it('returns passed once the verdict on the head is success', async () => {
    const read = sequence(makeSnapshot(pending('Re-evaluating')), makeSnapshot(success));
    const result = await waitForMergeSafety('o/r', 7, { ...makeClock(), ...fast, read });
    expect(result.outcome).toBe('passed');
  });

  it('returns failed on a failure verdict', async () => {
    const read = sequence(
      makeSnapshot({ source: 'status', state: 'failure', title: 'Merge conflict' }),
    );
    const result = await waitForMergeSafety('o/r', 7, { ...makeClock(), ...fast, read });
    expect(result.outcome).toBe('failed');
  });

  // The stuck rollout PRs: `Update required` is an in_progress check that never
  // re-runs without a branch update, so the wait must end at once, not time out.
  it('returns blocked on Update required without waiting', async () => {
    const clock = makeClock();
    const read = sequence(makeSnapshot(pending('Update required')));
    const result = await waitForMergeSafety('o/r', 7, { ...clock, ...fast, read });
    expect([result.outcome, result.elapsedSeconds]).toEqual(['blocked', 0]);
  });

  // Right after a rebase the new head has no verdict yet; that is a wait, not a
  // block and not a stale verdict carried over from the old head.
  it('waits through the post-rebase window until the new head is evaluated', async () => {
    const read = sequence(
      makeSnapshot(null, { headSha: 'head-b' }),
      makeSnapshot(null, { headSha: 'head-b' }),
      makeSnapshot(pending('Re-evaluating'), { headSha: 'head-b' }),
      makeSnapshot(success, { headSha: 'head-b' }),
    );
    const result = await waitForMergeSafety('o/r', 7, { ...makeClock(), ...fast, read });
    expect([result.outcome, result.headSha]).toEqual(['passed', 'head-b']);
  });

  // A cancelled first evaluation posts no verdict, so waiting for one is unbounded
  // unless the wait gives up on a head that stays empty.
  it('returns no-verdict when the head never gets a verdict', async () => {
    const read = sequence(makeSnapshot(null));
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      noVerdictGraceMs: 120_000,
      timeoutMs: 600_000,
    });
    expect([result.outcome, result.elapsedSeconds]).toEqual(['no-verdict', 120]);
  });

  it('restarts the no-verdict grace when the head moves', async () => {
    const read = sequence(
      makeSnapshot(null, { headSha: 'head-a' }),
      makeSnapshot(null, { headSha: 'head-a' }),
      makeSnapshot(null, { headSha: 'head-a' }),
      makeSnapshot(null, { headSha: 'head-b' }),
      makeSnapshot(null, { headSha: 'head-b' }),
      makeSnapshot(null, { headSha: 'head-b' }),
      makeSnapshot(success, { headSha: 'head-b' }),
    );
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      noVerdictGraceMs: 90_000,
    });
    expect(result.outcome).toBe('passed');
  });

  // A `Re-evaluating` mark whose dispatch failed or was cancelled never completes
  // on its own; it gets the same grace as a head with nothing posted.
  it('returns no-verdict on a Re-evaluating mark that never resolves', async () => {
    const read = sequence(makeSnapshot(pending('Re-evaluating')));
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      noVerdictGraceMs: 120_000,
      timeoutMs: 600_000,
    });
    expect([result.outcome, result.elapsedSeconds]).toEqual(['no-verdict', 120]);
  });

  it('times out when the head keeps moving', async () => {
    let n = 0;
    const read: Reader = async () => makeSnapshot(null, { headSha: `head-${n++}` });
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      noVerdictGraceMs: 60_000,
      timeoutMs: 120_000,
    });
    expect([result.outcome, result.elapsedSeconds]).toEqual(['timeout', 120]);
  });

  // GitHub applies a branch update asynchronously, so right after updating, the PR
  // can still show the old head and its old `Update required`.
  it('does not report blocked on the previous head while an update lands', async () => {
    const read = sequence(
      makeSnapshot(pending('Update required'), { headSha: 'head-old' }),
      makeSnapshot(null, { headSha: 'head-new' }),
      makeSnapshot(success, { headSha: 'head-new' }),
    );
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      previousHead: 'head-old',
    });
    expect([result.outcome, result.headSha]).toEqual(['passed', 'head-new']);
  });

  it('returns no-verdict when an expected update never lands', async () => {
    const read = sequence(makeSnapshot(pending('Update required'), { headSha: 'head-old' }));
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      previousHead: 'head-old',
      noVerdictGraceMs: 120_000,
    });
    expect(result.outcome).toBe('no-verdict');
  });

  it('matches an abbreviated previous head', async () => {
    const read = sequence(
      makeSnapshot(pending('Update required'), { headSha: 'abcdef1234' }),
      makeSnapshot(success, { headSha: 'fedcba9876' }),
    );
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      previousHead: 'abcdef1',
    });
    expect(result.outcome).toBe('passed');
  });

  // A refused or no-op update leaves the head where it was; a `passed` verdict
  // there is still final.
  it('reports passed on the previous head without waiting for it to move', async () => {
    const read = sequence(makeSnapshot(success, { headSha: 'head-old' }));
    const result = await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      previousHead: 'head-old',
    });
    expect([result.outcome, result.elapsedSeconds]).toEqual(['passed', 0]);
  });

  it('returns merged when the PR is merged during the wait', async () => {
    const read = sequence(makeSnapshot(null), makeSnapshot(null, { state: 'merged' }));
    const result = await waitForMergeSafety('o/r', 7, { ...makeClock(), ...fast, read });
    expect(result.outcome).toBe('merged');
  });

  it('gives up with error after repeated read failures', async () => {
    const read = sequence(null);
    const result = await waitForMergeSafety('o/r', 7, { ...makeClock(), ...fast, read });
    expect(result.outcome).toBe('error');
  });

  it('rides out a transient read failure', async () => {
    const read = sequence(null, null, makeSnapshot(success));
    const result = await waitForMergeSafety('o/r', 7, { ...makeClock(), ...fast, read });
    expect(result.outcome).toBe('passed');
  });

  it('reports each new waiting reason once', async () => {
    const updates: string[] = [];
    const read = sequence(
      makeSnapshot(null),
      makeSnapshot(null),
      makeSnapshot(pending('Re-evaluating')),
      makeSnapshot(success),
    );
    await waitForMergeSafety('o/r', 7, {
      ...makeClock(),
      ...fast,
      read,
      onUpdate: (r) => updates.push(r),
    });
    expect(updates).toEqual([
      'no merge-safety verdict on head-a yet',
      'merge-safety pending on head-a (Re-evaluating)',
    ]);
  });
});
