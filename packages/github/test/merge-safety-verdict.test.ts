import { describe, it, expect } from 'vitest';
import { classifyMergeSafety } from '../src/merge-safety-verdict.js';
import type { MergeSafetyReport, MergeSafetySnapshot } from '../src/merge-safety-state.js';

const HEAD = 'abcdef1234567890';

function makeSnapshot(report: MergeSafetyReport | null, over: Partial<MergeSafetySnapshot> = {}) {
  return { state: 'open' as const, headSha: HEAD, report, ...over };
}

function makeReport(state: MergeSafetyReport['state'], title: string): MergeSafetyReport {
  return { source: 'status', state, title };
}

describe('classifyMergeSafety', () => {
  it('passes on a success verdict', () => {
    const snapshot = makeSnapshot(makeReport('success', 'No update required'));
    expect(classifyMergeSafety(snapshot)).toEqual({
      status: 'passed',
      reason: 'No update required on abcdef1',
    });
  });

  it('fails on a failure verdict, naming its title', () => {
    const snapshot = makeSnapshot(makeReport('failure', 'Merge conflict'));
    expect(classifyMergeSafety(snapshot)).toEqual({
      status: 'failed',
      reason: 'Merge conflict on abcdef1',
    });
  });

  // merge-safety posts `Update required` as an incomplete check, so it reads as
  // still running; waiting on it never ends because it re-runs only on a new head.
  it('reports a pending Update required as blocked, not still running', () => {
    const snapshot = makeSnapshot(makeReport('pending', 'Update required'));
    expect(classifyMergeSafety(snapshot).status).toBe('blocked');
  });

  it('keeps waiting on a pending Re-evaluating mark', () => {
    const snapshot = makeSnapshot(makeReport('pending', 'Re-evaluating'));
    expect(classifyMergeSafety(snapshot).status).toBe('waiting');
  });

  it('does not mistake No update required for Update required', () => {
    // A stray pending state with the success title must not read as blocked.
    const snapshot = makeSnapshot(makeReport('pending', 'No update required'));
    expect(classifyMergeSafety(snapshot).status).toBe('waiting');
  });

  it('keeps waiting while the head has no verdict yet', () => {
    expect(classifyMergeSafety(makeSnapshot(null))).toEqual({
      status: 'waiting',
      reason: 'no merge-safety verdict on abcdef1 yet',
    });
  });

  it('reports a merged PR as closed', () => {
    expect(classifyMergeSafety(makeSnapshot(null, { state: 'merged' }))).toEqual({
      status: 'closed',
      reason: 'PR is merged',
    });
  });
});
