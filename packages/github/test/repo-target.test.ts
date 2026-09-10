import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { resolveRepoTarget } = await import('../src/gh-call.js');

describe('resolveRepoTarget', () => {
  beforeEach(() => boundedRun.mockReset());

  it('returns the explicit --repo without consulting GH_REPO or gh', async () => {
    const out = await resolveRepoTarget({ repo: 'owner/explicit', env: { GH_REPO: 'owner/env' } });
    expect(out).toBe('owner/explicit');
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('trims the explicit --repo and treats a blank one as unset', async () => {
    expect(await resolveRepoTarget({ repo: '  owner/spaced  ', env: {} })).toBe('owner/spaced');
    // A blank explicit repo falls through to GH_REPO.
    expect(await resolveRepoTarget({ repo: '   ', env: { GH_REPO: 'owner/env' } })).toBe(
      'owner/env',
    );
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('falls back to GH_REPO before shelling to gh repo view', async () => {
    const out = await resolveRepoTarget({ env: { GH_REPO: 'owner/from-env' } });
    expect(out).toBe('owner/from-env');
    // GH_REPO short-circuits the cwd resolver — gh repo view is never run.
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('falls back to the cwd gh repo view when neither override is set', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'owner/from-cwd\n' }));
    const out = await resolveRepoTarget({ env: {} });
    expect(out).toBe('owner/from-cwd');
    expect(boundedRun.mock.calls[0]?.[1]).toEqual([
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]);
  });

  it('soft-fails to null when nothing resolves', async () => {
    boundedRun.mockResolvedValue(result({ stderr: 'not a repo', code: 1 }));
    // Inject a no-op sleeper so the cwd resolver's retry backoff doesn't add real delay.
    expect(await resolveRepoTarget({ env: {}, sleep: async () => {} })).toBeNull();
  });
});
