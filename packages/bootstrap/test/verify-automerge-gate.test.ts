import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transport } from '@rmartz/github';

const ghCall = vi.fn();
const resolveRepoTarget = vi.fn();
vi.mock('@rmartz/github', () => ({ ghCall, resolveRepoTarget }));

const { verifyAutomergeGate } = await import('../src/verify-automerge-gate.js');

/**
 * Route a mocked `ghCall` by the shape of its primary argv, so each test states
 * repo state declaratively rather than ordering `mockResolvedValueOnce`s.
 *
 * Required-check state is expressed on two independent axes so a test can pin
 * exactly where a check comes from: `rulesetChecks` (the effective rules the
 * Rulesets API reports on the branch) and `classicChecks` (legacy branch
 * protection, `null` = no classic protection object at all). `managedRuleset`
 * models the tool-owned ruleset for the apply path — `null` means it must be
 * created, an object means it exists and is updated.
 */
function arrange(state: {
  branch?: string;
  allowAutoMerge?: boolean;
  rulesetChecks?: string[] | null;
  classicChecks?: string[] | null;
  squashCorrect?: boolean;
  managedRuleset?: { id: number; contexts: string[] } | null;
}) {
  const branch = state.branch ?? 'main';
  const rulesetChecks = state.rulesetChecks ?? [];
  const managed = state.managedRuleset ?? null;
  ghCall.mockImplementation(async (primary: Transport) => {
    const argv = primary.argv.join(' ');
    if (argv.includes('repo view')) return branch;
    if (argv.includes('--jq .allow_auto_merge')) return state.allowAutoMerge ? 'true' : 'false';
    // Squash-setting READ (the PATCH also names the field, so exclude writes).
    if (argv.includes('squash_merge_commit_title') && !argv.includes('PATCH')) {
      return JSON.stringify(
        state.squashCorrect
          ? { squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY' }
          : {
              squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
              squash_merge_commit_message: 'COMMIT_MESSAGES',
            },
      );
    }
    // Effective ruleset rules on the branch (the modern source of truth).
    if (argv.includes('rules/branches')) {
      return JSON.stringify(
        rulesetChecks.length
          ? [
              {
                type: 'required_status_checks',
                parameters: { required_status_checks: rulesetChecks.map((c) => ({ context: c })) },
              },
            ]
          : [],
      );
    }
    // Legacy branch protection (drift signal + union for fail-closed).
    if (argv.includes('protection/required_status_checks')) {
      return state.classicChecks === null || state.classicChecks === undefined
        ? null // 404 / no classic protection
        : JSON.stringify({ contexts: state.classicChecks });
    }
    // Managed-ruleset write (PUT existing) / read (GET one).
    if (argv.includes('rulesets/')) {
      if (argv.includes('PUT')) return 'ok';
      return JSON.stringify({
        id: managed?.id,
        name: 'Auto-merge gate',
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: (managed?.contexts ?? []).map((c) => ({ context: c })),
            },
          },
        ],
      });
    }
    if (argv.includes('rulesets')) {
      if (argv.includes('POST')) return 'ok'; // create
      // list
      return JSON.stringify(managed ? [{ id: managed.id, name: 'Auto-merge gate' }] : []);
    }
    return 'ok'; // PATCH writes (allow_auto_merge, squash)
  });
}

function writeCalls() {
  return ghCall.mock.calls.filter((c) => {
    const argv = (c[0] as Transport).argv.join(' ');
    return argv.includes('POST') || argv.includes('PUT') || argv.includes('PATCH');
  });
}

beforeEach(() => {
  ghCall.mockReset();
  resolveRepoTarget.mockReset().mockResolvedValue('rmartz/demo');
});

// Criterion 1 — the read path resolves required checks from Rulesets, fail-closed.
describe('verifyAutomergeGate — confirm (read-only)', () => {
  it('is satisfied when the gate check is required via a ruleset (no classic protection)', async () => {
    arrange({
      allowAutoMerge: true,
      rulesetChecks: ['merge-safety', 'Test'],
      classicChecks: null,
      squashCorrect: true,
    });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(true);
    expect(res.missingChecks).toEqual([]);
    expect(res.classicProtection).toBe(false);
    expect(res.applied).toBe(false);
  });

  it('is unsatisfied when neither a ruleset nor classic protection requires the gate check (fails closed)', async () => {
    arrange({ allowAutoMerge: true, rulesetChecks: [], classicChecks: null });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.missingChecks).toEqual(['merge-safety']);
  });

  it('is unsatisfied when the squash-merge commit setting is not PR title + body', async () => {
    arrange({ allowAutoMerge: true, rulesetChecks: ['merge-safety'], squashCorrect: false });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.squashCommitCorrect).toBe(false);
    expect(res.missingChecks).toEqual([]); // gate checks are fine; only squash is wrong
  });

  it('is unsatisfied when allow_auto_merge is off even if the check is required', async () => {
    arrange({ allowAutoMerge: false, rulesetChecks: ['merge-safety'] });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.allowAutoMerge).toBe(false);
  });

  it('never writes in confirm mode', async () => {
    arrange({ allowAutoMerge: false, rulesetChecks: [], classicChecks: null });
    await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(writeCalls()).toHaveLength(0);
  });
});

// Criterion 1 (union) + Criterion 4 — classic protection counts toward the gate
// but is surfaced as drift to migrate.
describe('verifyAutomergeGate — classic-protection drift', () => {
  it('counts a classic-required gate check toward satisfaction and flags the drift', async () => {
    arrange({
      allowAutoMerge: true,
      rulesetChecks: [],
      classicChecks: ['merge-safety'],
      squashCorrect: true,
    });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(true);
    expect(res.missingChecks).toEqual([]);
    expect(res.classicProtection).toBe(true);
  });

  it('reports no drift when only a ruleset protects the branch', async () => {
    arrange({ allowAutoMerge: true, rulesetChecks: ['merge-safety'], classicChecks: null });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.classicProtection).toBe(false);
  });
});

// Criterion 2 + 3 — apply creates/updates a managed ruleset (never classic PUT),
// idempotently, with a non-strict required-checks policy.
describe('verifyAutomergeGate — apply', () => {
  it('creates the managed ruleset with the gate checks and a non-strict policy', async () => {
    arrange({
      allowAutoMerge: false,
      rulesetChecks: [],
      classicChecks: null,
      managedRuleset: null,
    });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });

    expect(res.applied).toBe(true);
    expect(res.satisfied).toBe(true);

    const patch = ghCall.mock.calls.find((c) =>
      (c[0] as Transport).argv.join(' ').includes('allow_auto_merge=true'),
    );
    expect(patch).toBeDefined();

    const post = ghCall.mock.calls.find((c) => {
      const argv = (c[0] as Transport).argv.join(' ');
      return argv.includes('POST') && argv.includes('rulesets');
    });
    expect(post).toBeDefined();
    const body = JSON.parse((post?.[0] as Transport).stdin ?? '{}');
    const rule = body.rules.find((r: { type: string }) => r.type === 'required_status_checks');
    expect(rule.parameters.required_status_checks).toEqual([{ context: 'merge-safety' }]);
    expect(rule.parameters.strict_required_status_checks_policy).toBe(false);
    // Never touches classic branch protection.
    const classicPut = ghCall.mock.calls.some((c) => {
      const argv = (c[0] as Transport).argv.join(' ');
      return argv.includes('PUT') && argv.includes('protection');
    });
    expect(classicPut).toBe(false);
  });

  it('updates the existing managed ruleset with the union of its checks + the gate checks', async () => {
    arrange({
      allowAutoMerge: true,
      rulesetChecks: ['Test'],
      classicChecks: null,
      managedRuleset: { id: 42, contexts: ['Test'] },
    });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    expect(res.applied).toBe(true);

    const put = ghCall.mock.calls.find((c) => {
      const argv = (c[0] as Transport).argv.join(' ');
      return argv.includes('PUT') && argv.includes('rulesets/42');
    });
    expect(put).toBeDefined();
    const body = JSON.parse((put?.[0] as Transport).stdin ?? '{}');
    const rule = body.rules.find((r: { type: string }) => r.type === 'required_status_checks');
    expect(rule.parameters.required_status_checks).toEqual(
      expect.arrayContaining([{ context: 'Test' }, { context: 'merge-safety' }]),
    );
  });

  it('does not enable auto-merge again when it is already on', async () => {
    arrange({ allowAutoMerge: true, rulesetChecks: [], classicChecks: null, squashCorrect: true });
    await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    const reEnabled = ghCall.mock.calls.some((c) =>
      (c[0] as Transport).argv.join(' ').includes('allow_auto_merge=true'),
    );
    expect(reEnabled).toBe(false);
  });

  it('sets the squash-merge commit to PR title + body when it is wrong', async () => {
    arrange({ allowAutoMerge: true, rulesetChecks: ['merge-safety'], squashCorrect: false });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    expect(res.applied).toBe(true);
    expect(res.squashCommitCorrect).toBe(true);
    const squashPatch = ghCall.mock.calls.find((c) => {
      const argv = (c[0] as Transport).argv.join(' ');
      return argv.includes('PATCH') && argv.includes('squash_merge_commit_title=PR_TITLE');
    });
    expect(squashPatch).toBeDefined();
  });

  it('does not write when the gate is already satisfied (idempotent)', async () => {
    arrange({ allowAutoMerge: true, rulesetChecks: ['merge-safety'], squashCorrect: true });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    expect(res.applied).toBe(false);
    expect(writeCalls()).toHaveLength(0);
  });
});

describe('verifyAutomergeGate — repo resolution', () => {
  it('throws when the repo cannot be resolved', async () => {
    resolveRepoTarget.mockResolvedValueOnce(null);
    await expect(verifyAutomergeGate()).rejects.toThrow(/could not determine repo/);
  });
});
