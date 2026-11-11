import { describe, it, expect } from 'vitest';
import { classifyDependabotResponse } from '../src/dependabot-response.js';
import type { DependabotSnapshot } from '../src/dependabot-state.js';

const REQUESTED_AT = '2026-11-11T19:17:00Z';
const REQUESTED_MS = Date.parse(REQUESTED_AT);

function makeSnapshot(over: Partial<DependabotSnapshot> = {}): DependabotSnapshot {
  return {
    state: 'open',
    rebaseMarker: 'none',
    request: { commentId: 1, createdAt: REQUESTED_AT, acknowledged: false },
    lastBotCommitAt: '2026-11-11T19:12:04Z',
    lastBotCommentAt: '',
    ...over,
  };
}

const at = (secondsAfterRequest: number) => ({ now: REQUESTED_MS + secondsAfterRequest * 1000 });

describe('classifyDependabotResponse', () => {
  it('answers when the PR is merged', () => {
    expect(classifyDependabotResponse(makeSnapshot({ state: 'merged' }), at(5))).toEqual({
      status: 'answered',
      reason: 'PR is merged',
    });
  });

  it('answers when Dependabot pushed after the request', () => {
    const snapshot = makeSnapshot({ lastBotCommitAt: '2026-11-11T19:17:40Z' });
    expect(classifyDependabotResponse(snapshot, at(500)).status).toBe('answered');
  });

  it('answers when Dependabot commented after the request', () => {
    const snapshot = makeSnapshot({ lastBotCommentAt: '2026-11-11T19:17:10Z' });
    expect(classifyDependabotResponse(snapshot, at(500))).toEqual({
      status: 'answered',
      reason: 'Dependabot commented (likely a refusal; see the PR)',
    });
  });

  it('stays pending on an unacknowledged request inside the grace period', () => {
    expect(classifyDependabotResponse(makeSnapshot(), { ...at(60), ackGraceMs: 120_000 })).toEqual({
      status: 'pending',
    });
  });

  it('flags an unacknowledged request past the grace period as missed', () => {
    expect(
      classifyDependabotResponse(makeSnapshot(), { ...at(121), ackGraceMs: 120_000 }).status,
    ).toBe('missed');
  });

  it('keeps waiting on an acknowledged request past the grace period', () => {
    const snapshot = makeSnapshot({
      request: { commentId: 1, createdAt: REQUESTED_AT, acknowledged: true },
    });
    expect(classifyDependabotResponse(snapshot, { ...at(600), ackGraceMs: 120_000 })).toEqual({
      status: 'pending',
    });
  });

  it('stays pending on a self-started rebase with no request', () => {
    const snapshot = makeSnapshot({ request: null, rebaseMarker: 'in_progress' });
    expect(classifyDependabotResponse(snapshot, at(5))).toEqual({ status: 'pending' });
  });

  it('answers a self-started rebase that failed', () => {
    const snapshot = makeSnapshot({ request: null, rebaseMarker: 'failed' });
    expect(classifyDependabotResponse(snapshot, at(5))).toEqual({
      status: 'answered',
      reason: 'Dependabot rebase failed (see the PR)',
    });
  });

  it('answers when there is neither a request nor a rebase marker', () => {
    const snapshot = makeSnapshot({ request: null });
    expect(classifyDependabotResponse(snapshot, at(5))).toEqual({
      status: 'answered',
      reason: 'no rebase/recreate request on record',
    });
  });
});
