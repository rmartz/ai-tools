import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifyAutomergeGateResult } from '../src/verify-automerge-gate.js';

const verifyAutomergeGate = vi.fn();
vi.mock('../src/verify-automerge-gate.js', () => ({ verifyAutomergeGate }));

const { auditFleet } = await import('../src/fleet-audit.js');

/** A satisfied, ruleset-protected gate result; override to model each repo. */
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
    rulesetProtection: true,
    satisfied: true,
    applied: false,
    ...overrides,
  };
}

/** Route the mocked verifier by repo; unlisted repos return a default satisfied result. */
function byRepo(map: Record<string, VerifyAutomergeGateResult>) {
  verifyAutomergeGate.mockImplementation(
    async ({ repo }: { repo: string }) => map[repo] ?? makeGateResult({ repo }),
  );
}

beforeEach(() => {
  verifyAutomergeGate.mockReset();
});

// Criterion 1 + 3 — classify each repo's protection mechanism from the
// ruleset/classic presence flags.
describe('auditFleet — mechanism classification', () => {
  it('maps ruleset/classic presence to none | classic | ruleset | both', async () => {
    byRepo({
      'o/ruleset': makeGateResult({
        repo: 'o/ruleset',
        rulesetProtection: true,
        classicProtection: false,
      }),
      'o/classic': makeGateResult({
        repo: 'o/classic',
        rulesetProtection: false,
        classicProtection: true,
      }),
      'o/both': makeGateResult({
        repo: 'o/both',
        rulesetProtection: true,
        classicProtection: true,
      }),
      'o/none': makeGateResult({
        repo: 'o/none',
        rulesetProtection: false,
        classicProtection: false,
        requiredChecks: [],
        missingChecks: ['merge-safety'],
        satisfied: false,
      }),
    });
    const { rows } = await auditFleet({ repos: ['o/ruleset', 'o/classic', 'o/both', 'o/none'] });
    expect(rows.map((r) => [r.repo, r.mechanism])).toEqual([
      ['o/ruleset', 'ruleset'],
      ['o/classic', 'classic'],
      ['o/both', 'both'],
      ['o/none', 'none'],
    ]);
  });
});

// Criterion 1 — aggregate a fleet summary the caller can turn into a go/no-go.
describe('auditFleet — summary aggregation', () => {
  it('counts satisfied / unsatisfied / classic-drift across the fleet', async () => {
    byRepo({
      'o/good': makeGateResult({ repo: 'o/good', satisfied: true }),
      'o/bad': makeGateResult({ repo: 'o/bad', satisfied: false, missingChecks: ['merge-safety'] }),
      'o/drift': makeGateResult({ repo: 'o/drift', satisfied: true, classicProtection: true }),
    });
    const { summary } = await auditFleet({ repos: ['o/good', 'o/bad', 'o/drift'] });
    expect(summary).toEqual({
      total: 3,
      satisfied: 2,
      unsatisfied: 1,
      classicDrift: 1,
      errored: 0,
    });
  });
});

// Criterion 2 — strictly read-only: the audit never requests apply.
describe('auditFleet — read-only', () => {
  it('never passes apply to the underlying verifier', async () => {
    verifyAutomergeGate.mockResolvedValue(makeGateResult());
    await auditFleet({ repos: ['o/a', 'o/b'] });
    expect(verifyAutomergeGate).toHaveBeenCalledTimes(2);
    for (const call of verifyAutomergeGate.mock.calls) {
      expect((call[0] as { apply?: boolean }).apply).toBeFalsy();
    }
  });

  it('forwards custom gate checks to each repo audit', async () => {
    verifyAutomergeGate.mockResolvedValue(makeGateResult());
    await auditFleet({ repos: ['o/a'], gateChecks: ['Test', 'Build'] });
    expect(verifyAutomergeGate).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'o/a', gateChecks: ['Test', 'Build'] }),
    );
  });
});

// Criterion 2 + 5 — a repo that can't be read fails closed without aborting the sweep.
describe('auditFleet — fail-closed on an unreadable repo', () => {
  it('records the failing repo as not-ok and unsatisfied, and continues the others', async () => {
    verifyAutomergeGate.mockImplementation(async ({ repo }: { repo: string }) => {
      if (repo === 'o/broken') throw new Error('gh api failed: HTTP 403');
      return makeGateResult({ repo });
    });
    const { rows, summary } = await auditFleet({ repos: ['o/ok', 'o/broken'] });

    const broken = rows.find((r) => r.repo === 'o/broken');
    expect(broken?.ok).toBe(false);
    expect(broken?.satisfied).toBe(false);
    expect(broken?.error).toContain('403');
    expect(rows.find((r) => r.repo === 'o/ok')?.ok).toBe(true); // sweep continued
    expect(summary.errored).toBe(1);
  });
});
