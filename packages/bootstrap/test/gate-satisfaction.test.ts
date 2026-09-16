import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifyAutomergeGateResult } from '../src/verify-automerge-gate.js';

const verifyAutomergeGate = vi.fn();
vi.mock('../src/verify-automerge-gate.js', () => ({ verifyAutomergeGate }));

const { resolveSatisfiedGateChecks } = await import('../src/gate-satisfaction.js');

function makeGateResult(
  overrides: Partial<VerifyAutomergeGateResult> = {},
): VerifyAutomergeGateResult {
  return {
    repo: 'rmartz/demo',
    branch: 'main',
    allowAutoMerge: true,
    requiredChecks: ['merge-safety'],
    gateChecks: ['merge-safety'],
    missingChecks: [],
    squashCommitCorrect: true,
    classicProtection: false,
    satisfied: true,
    applied: false,
    ...overrides,
  };
}

beforeEach(() => {
  verifyAutomergeGate.mockReset();
});

// #239 — the network bridge: return the satisfied gate checks so seeding can be
// conditioned on the real gate, read-only (never apply).
describe('resolveSatisfiedGateChecks', () => {
  it('returns the checked gate set when the gate is satisfied', async () => {
    verifyAutomergeGate.mockResolvedValue(makeGateResult({ satisfied: true }));
    const satisfied = await resolveSatisfiedGateChecks({
      repo: 'o/a',
      gateChecks: ['merge-safety'],
    });
    expect(satisfied).toEqual(['merge-safety']);
  });

  it('returns an empty set when the gate is not satisfied (withhold-safe)', async () => {
    verifyAutomergeGate.mockResolvedValue(
      makeGateResult({ satisfied: false, missingChecks: ['merge-safety'] }),
    );
    const satisfied = await resolveSatisfiedGateChecks({
      repo: 'o/a',
      gateChecks: ['merge-safety'],
    });
    expect(satisfied).toEqual([]);
  });

  it('reads the gate read-only — never requests apply', async () => {
    verifyAutomergeGate.mockResolvedValue(makeGateResult());
    await resolveSatisfiedGateChecks({ repo: 'o/a' });
    const call = verifyAutomergeGate.mock.calls[0]?.[0] as { apply?: boolean };
    expect(call.apply).toBeFalsy();
  });
});
