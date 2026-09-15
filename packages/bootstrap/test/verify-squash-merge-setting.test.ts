import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transport } from '@rmartz/github';

const ghCall = vi.fn();
const resolveRepoTarget = vi.fn();
vi.mock('@rmartz/github', () => ({ ghCall, resolveRepoTarget }));

const { verifySquashMergeSetting } = await import('../src/verify-squash-merge-setting.js');

/**
 * Route a mocked `ghCall` by the shape of its argv: the repo read returns the
 * declared settings as the `--jq` object shape; the PATCH write returns `ok`.
 */
function arrange(state: { title?: string | null; message?: string | null }) {
  ghCall.mockImplementation(async (primary: Transport) => {
    const argv = primary.argv.join(' ');
    if (argv.includes('PATCH')) return 'ok';
    if (argv.includes('gh api repos/')) {
      return JSON.stringify({ title: state.title ?? null, message: state.message ?? null });
    }
    return 'ok';
  });
}

beforeEach(() => {
  ghCall.mockReset();
  resolveRepoTarget.mockReset().mockResolvedValue('rmartz/demo');
});

// Criterion 1 (confirm, read-only) — satisfied only when BOTH the squash title
// source is PR_TITLE and the message source is PR_BODY, so the conventional PR
// title reaches `main`.
describe('verifySquashMergeSetting — confirm (read-only)', () => {
  it('is satisfied when title=PR_TITLE and message=PR_BODY', async () => {
    arrange({ title: 'PR_TITLE', message: 'PR_BODY' });
    const res = await verifySquashMergeSetting();
    expect(res.satisfied).toBe(true);
    expect(res.applied).toBe(false);
  });

  it('is unsatisfied when the title source is the commit message, not the PR title', async () => {
    arrange({ title: 'COMMIT_OR_PR_TITLE', message: 'COMMIT_MESSAGES' });
    const res = await verifySquashMergeSetting();
    expect(res.satisfied).toBe(false);
    expect(res.squashTitle).toBe('COMMIT_OR_PR_TITLE');
  });

  it('is unsatisfied when the title is right but the message source drifted', async () => {
    arrange({ title: 'PR_TITLE', message: 'COMMIT_MESSAGES' });
    const res = await verifySquashMergeSetting();
    expect(res.satisfied).toBe(false);
  });

  it('never writes in confirm mode', async () => {
    arrange({ title: 'COMMIT_OR_PR_TITLE', message: 'COMMIT_MESSAGES' });
    await verifySquashMergeSetting();
    const wrote = ghCall.mock.calls.some((c) =>
      (c[0] as Transport).argv.join(' ').includes('PATCH'),
    );
    expect(wrote).toBe(false);
  });
});

// Criterion 1 (--apply, state-changing) — PATCH the repo to PR_TITLE + PR_BODY.
describe('verifySquashMergeSetting — apply', () => {
  it('PATCHes the repo to PR_TITLE + PR_BODY and reports satisfied', async () => {
    arrange({ title: 'COMMIT_OR_PR_TITLE', message: 'COMMIT_MESSAGES' });
    const res = await verifySquashMergeSetting({ apply: true });

    expect(res.applied).toBe(true);
    expect(res.satisfied).toBe(true);

    const patch = ghCall.mock.calls.find((c) =>
      (c[0] as Transport).argv.join(' ').includes('PATCH'),
    );
    const argv = (patch?.[0] as Transport).argv.join(' ');
    expect(argv).toContain('squash_merge_commit_title=PR_TITLE');
    expect(argv).toContain('squash_merge_commit_message=PR_BODY');
  });

  it('does not write when the setting is already satisfied', async () => {
    arrange({ title: 'PR_TITLE', message: 'PR_BODY' });
    const res = await verifySquashMergeSetting({ apply: true });
    expect(res.applied).toBe(false);
    const wrote = ghCall.mock.calls.some((c) =>
      (c[0] as Transport).argv.join(' ').includes('PATCH'),
    );
    expect(wrote).toBe(false);
  });
});

describe('verifySquashMergeSetting — repo resolution', () => {
  it('throws when the repo cannot be resolved', async () => {
    resolveRepoTarget.mockResolvedValueOnce(null);
    await expect(verifySquashMergeSetting()).rejects.toThrow(/could not determine repo/);
  });
});
