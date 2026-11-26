import { describe, it, expect } from 'vitest';
import { waitForDependabot } from '../src/wait-for-dependabot.js';
import type { DependabotSnapshot } from '../src/dependabot-state.js';

const REQUESTED_AT = '2026-11-11T19:17:00Z';
const START = Date.parse(REQUESTED_AT);

function makeSnapshot(over: Partial<DependabotSnapshot> = {}): DependabotSnapshot {
  return {
    state: 'open',
    rebaseMarker: 'none',
    request: { commentId: 1, createdAt: REQUESTED_AT, acknowledged: true },
    lastBotCommitAt: '',
    lastBotCommentAt: '',
    ...over,
  };
}

/** A fake clock advanced only by the injected sleeper, so polls are instant. */
function makeClock() {
  let t = START;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

type Reader = (repo: string, pr: number) => Promise<DependabotSnapshot | null>;

describe('waitForDependabot', () => {
  it('returns answered once a PR is answered', async () => {
    const read: Reader = async () => makeSnapshot({ state: 'merged' });
    const result = await waitForDependabot('o/r', [42], { ...makeClock(), read });
    expect(result.outcome).toBe('answered');
  });

  it('returns missed when the request is never acknowledged', async () => {
    const read: Reader = async () =>
      makeSnapshot({ request: { commentId: 1, createdAt: REQUESTED_AT, acknowledged: false } });
    const result = await waitForDependabot('o/r', [42], {
      ...makeClock(),
      read,
      intervalMs: 30_000,
      ackGraceMs: 90_000,
    });
    expect(result.outcome).toBe('missed');
  });

  it('times out on an acknowledged request that never completes', async () => {
    const read: Reader = async () => makeSnapshot();
    const result = await waitForDependabot('o/r', [42], {
      ...makeClock(),
      read,
      intervalMs: 30_000,
      timeoutMs: 120_000,
    });
    expect(result.outcome).toBe('timeout');
  });

  it('gives up with error after repeated read failures', async () => {
    const read: Reader = async () => null;
    const result = await waitForDependabot('o/r', [42], { ...makeClock(), read });
    expect(result.outcome).toBe('error');
  });

  it('with all, reports missed when any PR was missed', async () => {
    const read: Reader = async (_repo, pr) =>
      pr === 1
        ? makeSnapshot({ state: 'merged' })
        : makeSnapshot({ request: { commentId: 2, createdAt: REQUESTED_AT, acknowledged: false } });
    const result = await waitForDependabot('o/r', [1, 2], {
      ...makeClock(),
      read,
      all: true,
      ackGraceMs: 60_000,
    });
    expect(result.resolved.map((r) => [r.pr, r.status])).toEqual([
      [1, 'answered'],
      [2, 'missed'],
    ]);
  });
});
