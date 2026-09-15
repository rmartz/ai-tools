import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transport } from '@rmartz/github';

const ghCall = vi.fn();
const resolveRepoTarget = vi.fn();
vi.mock('@rmartz/github', () => ({ ghCall, resolveRepoTarget }));

const { verifyAutomergeGate } = await import('../src/verify-automerge-gate.js');

/**
 * Route a mocked `ghCall` by the shape of its primary argv, so each test states
 * repo state declaratively rather than ordering `mockResolvedValueOnce`s.
 */
function arrange(state: {
  branch?: string;
  allowAutoMerge?: boolean;
  requiredChecks?: string[] | null;
  squashCorrect?: boolean;
}) {
  const branch = state.branch ?? 'main';
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
    if (argv.includes('required_status_checks')) {
      return state.requiredChecks === null || state.requiredChecks === undefined
        ? null // 404 / unprotected
        : JSON.stringify({ strict: true, contexts: state.requiredChecks });
    }
    return 'ok'; // PATCH / PUT writes
  });
}

beforeEach(() => {
  ghCall.mockReset();
  resolveRepoTarget.mockReset().mockResolvedValue('rmartz/demo');
});

// Criterion B (confirm, read-only) — satisfied only when allow_auto_merge is on
// AND every gate check is marked required.
describe('verifyAutomergeGate — confirm (read-only)', () => {
  it('is satisfied when auto-merge is on, the gate check is required, and squash is correct', async () => {
    arrange({
      allowAutoMerge: true,
      requiredChecks: ['merge-safety', 'Test'],
      squashCorrect: true,
    });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(true);
    expect(res.missingChecks).toEqual([]);
    expect(res.squashCommitCorrect).toBe(true);
    expect(res.applied).toBe(false);
  });

  it('is unsatisfied when the squash-merge commit setting is not PR title + body', async () => {
    arrange({ allowAutoMerge: true, requiredChecks: ['merge-safety'], squashCorrect: false });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.squashCommitCorrect).toBe(false);
    expect(res.missingChecks).toEqual([]); // the gate checks are fine; only squash is wrong
  });

  it('is unsatisfied — with the check named — when the gate check is not required', async () => {
    arrange({ allowAutoMerge: true, requiredChecks: ['Test'] });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.missingChecks).toEqual(['merge-safety']);
  });

  it('is unsatisfied when the branch has no protection at all (fails closed)', async () => {
    arrange({ allowAutoMerge: true, requiredChecks: null });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.missingChecks).toEqual(['merge-safety']);
  });

  it('is unsatisfied when allow_auto_merge is off even if the check is required', async () => {
    arrange({ allowAutoMerge: false, requiredChecks: ['merge-safety'] });
    const res = await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    expect(res.satisfied).toBe(false);
    expect(res.allowAutoMerge).toBe(false);
  });

  it('never writes in confirm mode', async () => {
    arrange({ allowAutoMerge: false, requiredChecks: null });
    await verifyAutomergeGate({ gateChecks: ['merge-safety'] });
    const wrote = ghCall.mock.calls.some((c) => {
      const argv = (c[0] as Transport).argv.join(' ');
      return argv.includes('PUT') || argv.includes('PATCH');
    });
    expect(wrote).toBe(false);
  });
});

// Criterion B (--apply, state-changing) — enable auto-merge and add the missing
// gate checks (union with existing), then report satisfied.
describe('verifyAutomergeGate — apply', () => {
  it('enables auto-merge and PUTs protection with the union of existing + gate checks', async () => {
    arrange({ allowAutoMerge: false, requiredChecks: ['Test'] });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });

    expect(res.applied).toBe(true);
    expect(res.satisfied).toBe(true);

    const patch = ghCall.mock.calls.find((c) =>
      (c[0] as Transport).argv.join(' ').includes('PATCH'),
    );
    expect((patch?.[0] as Transport).argv).toContain('allow_auto_merge=true');

    const put = ghCall.mock.calls.find((c) => (c[0] as Transport).argv.join(' ').includes('PUT'));
    const body = JSON.parse((put?.[0] as Transport).stdin ?? '{}');
    // Existing required check preserved; gate check added.
    expect(body.required_status_checks.contexts).toEqual(
      expect.arrayContaining(['Test', 'merge-safety']),
    );
    expect(body.required_status_checks.strict).toBe(true);
  });

  it('does not enable auto-merge again when it is already on', async () => {
    arrange({ allowAutoMerge: true, requiredChecks: [], squashCorrect: true });
    await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    const patched = ghCall.mock.calls.some((c) =>
      (c[0] as Transport).argv.join(' ').includes('PATCH'),
    );
    expect(patched).toBe(false);
  });

  it('sets the squash-merge commit to PR title + body when it is wrong', async () => {
    arrange({ allowAutoMerge: true, requiredChecks: ['merge-safety'], squashCorrect: false });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    expect(res.applied).toBe(true);
    expect(res.squashCommitCorrect).toBe(true);
    const squashPatch = ghCall.mock.calls.find((c) => {
      const argv = (c[0] as Transport).argv.join(' ');
      return argv.includes('PATCH') && argv.includes('squash_merge_commit_title=PR_TITLE');
    });
    expect(squashPatch).toBeDefined();
    expect((squashPatch?.[0] as Transport).argv).toContain('squash_merge_commit_message=PR_BODY');
  });

  it('does not write when the gate is already satisfied', async () => {
    arrange({ allowAutoMerge: true, requiredChecks: ['merge-safety'], squashCorrect: true });
    const res = await verifyAutomergeGate({ apply: true, gateChecks: ['merge-safety'] });
    expect(res.applied).toBe(false);
  });
});

describe('verifyAutomergeGate — repo resolution', () => {
  it('throws when the repo cannot be resolved', async () => {
    resolveRepoTarget.mockResolvedValueOnce(null);
    await expect(verifyAutomergeGate()).rejects.toThrow(/could not determine repo/);
  });
});
