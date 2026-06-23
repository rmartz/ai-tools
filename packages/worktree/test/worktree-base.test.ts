import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh`/`git` are real-world boundaries — mock the runtime so the test is
// hermetic (deny-by-default subprocess/network).
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { resolveDefaultBranch, resolveBaseRef } = await import('../src/worktree-base.js');

beforeEach(() => boundedRun.mockReset());

describe('resolveDefaultBranch', () => {
  it('returns the gh-resolved default branch on the happy path', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'develop\n' }));
    expect(await resolveDefaultBranch()).toBe('develop');
    expect(boundedRun).toHaveBeenCalledTimes(1);
  });

  it('falls back to local origin/HEAD and warns when gh fails', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ code: 1, stderr: 'gh down' })) // gh repo view
      .mockResolvedValueOnce(result({ stdout: 'origin/main\n' })); // symbolic-ref
    const log = vi.fn();
    expect(await resolveDefaultBranch({ log })).toBe('main');
    expect(log).toHaveBeenCalledOnce();
  });

  it('parses the HEAD branch line from git remote show when origin/HEAD is absent', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ code: 1 })) // gh repo view
      .mockResolvedValueOnce(result({ code: 1 })) // symbolic-ref
      .mockResolvedValueOnce(result({ stdout: '  HEAD branch: master\n' })); // remote show
    expect(await resolveDefaultBranch({ log: vi.fn() })).toBe('master');
  });

  it('falls back to "main" when every resolution fails', async () => {
    boundedRun.mockResolvedValue(result({ code: 1 }));
    expect(await resolveDefaultBranch({ log: vi.fn() })).toBe('main');
  });
});

describe('resolveBaseRef', () => {
  it('returns a branch name verbatim without shelling out', async () => {
    expect(await resolveBaseRef('feat/issue-42-foo')).toBe('feat/issue-42-foo');
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('resolves a bare PR number to its head branch', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'feat/issue-42-foo\n' }));
    expect(await resolveBaseRef('1271')).toBe('feat/issue-42-foo');
  });

  it('resolves a #-prefixed PR reference', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'fix/bar\n' }));
    expect(await resolveBaseRef('#1271')).toBe('fix/bar');
  });

  it('throws when gh pr view fails for a PR reference', async () => {
    boundedRun.mockResolvedValueOnce(result({ code: 1, stderr: 'no such PR' }));
    await expect(resolveBaseRef('999')).rejects.toThrow(/PR #999/);
  });

  it('throws when the resolved head branch is empty', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: '  \n' }));
    await expect(resolveBaseRef('5')).rejects.toThrow(/empty head branch/);
  });
});
