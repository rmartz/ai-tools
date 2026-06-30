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

const view = (repo: string, branch = 'main') =>
  JSON.stringify({ nameWithOwner: repo, defaultBranchRef: { name: branch } });

const FULL_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const { resolveSignatureContext } = await import('../src/discuss-signature.js');

describe('resolveSignatureContext', () => {
  beforeEach(() => boundedRun.mockReset());

  it('auto-fills the working repo and its mainline sha (shortened to 12)', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stdout: view('rmartz/trip-planner') }))
      .mockResolvedValueOnce(result({ stdout: `${FULL_SHA}\n` }));
    expect(await resolveSignatureContext({ model: 'Claude Opus 4.8' })).toEqual({
      model: 'Claude Opus 4.8',
      project: 'rmartz/trip-planner',
      commit: 'a1b2c3d4e5f6',
    });
  });

  it('resolves the sha of the --project override repo', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stdout: view('rmartz/ai') }))
      .mockResolvedValueOnce(result({ stdout: `${FULL_SHA}\n` }));
    const sig = await resolveSignatureContext({ project: 'rmartz/ai' });
    expect(sig.project).toBe('rmartz/ai');
    expect(sig.commit).toBe('a1b2c3d4e5f6');
    expect(boundedRun.mock.calls[0]?.[1]).toContain('rmartz/ai');
  });

  it('skips gh entirely when both project and commit are explicit', async () => {
    const sig = await resolveSignatureContext({
      model: 'm',
      project: 'rmartz/ai',
      commit: 'feedface',
    });
    expect(sig).toEqual({ model: 'm', project: 'rmartz/ai', commit: 'feedface' });
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('uses an explicit --commit verbatim, resolving only the project name (no sha lookup)', async () => {
    // `currentRepo` returns the bare `nameWithOwner` (its `--jq` extracts it).
    boundedRun.mockResolvedValueOnce(result({ stdout: 'rmartz/trip-planner\n' }));
    const sig = await resolveSignatureContext({ commit: 'v1.2.3' });
    expect(sig.project).toBe('rmartz/trip-planner');
    expect(sig.commit).toBe('v1.2.3');
    // The whole point of #45: an explicit sha skips the branch-HEAD lookup, so
    // only the single name-resolving call is made.
    expect(boundedRun).toHaveBeenCalledTimes(1);
  });

  it('soft-fails to model-only when the repo cannot be resolved', async () => {
    boundedRun.mockResolvedValue(result({ stderr: 'nope', code: 1 }));
    const sig = await resolveSignatureContext({ model: 'm' }, { sleep: vi.fn(async () => {}) });
    expect(sig).toEqual({ model: 'm', project: undefined, commit: undefined });
  });
});
