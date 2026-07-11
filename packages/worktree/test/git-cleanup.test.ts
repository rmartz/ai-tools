import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));
const fetchPrSummary = vi.fn();
const gatherRepoStatus = vi.fn();
vi.mock('@rmartz/github', () => ({ fetchPrSummary, gatherRepoStatus }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { parseSecondaryWorktrees, classifyBranches, decideCleanup, runCleanup } =
  await import('../src/git-cleanup.js');

beforeEach(() => {
  boundedRun.mockReset();
  fetchPrSummary.mockReset();
  gatherRepoStatus.mockReset();
});

describe('parseSecondaryWorktrees', () => {
  it('skips the main worktree and detached entries, keeping (path, branch) pairs', () => {
    const porcelain = [
      'worktree /repo\nHEAD abc\nbranch refs/heads/main',
      'worktree /repo/.git-worktrees/feat-a\nHEAD def\nbranch refs/heads/feat/a',
      'worktree /repo/.git-worktrees/detached\nHEAD ghi\ndetached',
    ].join('\n\n');
    expect(parseSecondaryWorktrees(porcelain)).toEqual([
      { path: '/repo/.git-worktrees/feat-a', branch: 'feat/a' },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseSecondaryWorktrees('')).toEqual([]);
  });
});

describe('classifyBranches', () => {
  it('marks an open-PR head branch as open from the repo status snapshot', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [{ headRefName: 'feat/open' }] });
    const out = await classifyBranches(new Set(['feat/open']), 'o/r', undefined, vi.fn());
    expect(out.get('feat/open')).toBe('open');
    expect(boundedRun).not.toHaveBeenCalled(); // no per-branch gh pr list needed
  });

  it('marks a branch with only closed PRs as closed', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [] });
    boundedRun.mockResolvedValue(result({ stdout: JSON.stringify([{ number: 7 }]) }));
    fetchPrSummary.mockResolvedValue({ state: 'MERGED' });
    const out = await classifyBranches(new Set(['feat/done']), 'o/r', undefined, vi.fn());
    expect(out.get('feat/done')).toBe('closed');
  });

  it('marks a branch with no PRs as none (pre-PR WIP)', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [] });
    boundedRun.mockResolvedValue(result({ stdout: '[]' }));
    const out = await classifyBranches(new Set(['feat/wip']), 'o/r', undefined, vi.fn());
    expect(out.get('feat/wip')).toBe('none');
  });

  it('conservatively returns open when gh pr list fails', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [] });
    boundedRun.mockResolvedValue(result({ code: 1, stderr: 'boom' }));
    const log = vi.fn();
    const out = await classifyBranches(new Set(['feat/unknown']), 'o/r', undefined, log);
    expect(out.get('feat/unknown')).toBe('open');
    expect(log).toHaveBeenCalled();
  });
});

describe('decideCleanup', () => {
  it('removes a closed-PR branch', () => {
    expect(decideCleanup('closed', false, 30)).toEqual({
      remove: true,
      reason: 'PR closed/merged',
    });
  });

  it('removes an otherwise-kept branch once it is stale', () => {
    expect(decideCleanup('open', true, 30)).toEqual({
      remove: true,
      reason: 'stale — no commit in 30+ days',
    });
    expect(decideCleanup('none', true, 30).remove).toBe(true);
  });

  it('keeps a fresh open-PR branch and a fresh no-PR branch', () => {
    expect(decideCleanup('open', false, 30)).toEqual({ remove: false, reason: 'has open PR' });
    expect(decideCleanup('none', false, 30).reason).toBe('no PR yet — work in progress');
  });
});

describe('runCleanup', () => {
  // Helper to script git/gh subprocess responses by command shape.
  function scriptGit(
    handlers: (cmd: string, args: string[]) => ReturnType<typeof result> | undefined,
  ) {
    boundedRun.mockImplementation(async (cmd: string, args: string[]) => {
      const r = handlers(cmd, args);
      return r ?? result();
    });
  }

  it('removes a closed-PR worktree and deletes its branch; keeps WIP and open', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [{ headRefName: 'feat/open' }] });
    fetchPrSummary.mockResolvedValue({ state: 'CLOSED' });

    const removed: string[] = [];
    const deleted: string[] = [];
    scriptGit((cmd, args) => {
      if (cmd === 'git' && args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD')
        return result({ stdout: 'refs/remotes/origin/main\n' });
      if (cmd === 'git' && args[0] === 'symbolic-ref' && args[1] === '--short')
        return result({ stdout: 'feat/open\n' }); // current branch
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list')
        return result({
          stdout: [
            'worktree /repo\nbranch refs/heads/main',
            'worktree /repo/.git-worktrees/done\nbranch refs/heads/feat/done',
          ].join('\n\n'),
        });
      if (cmd === 'git' && args[0] === 'branch' && args.includes('--format=%(refname:short)'))
        return result({ stdout: 'feat/done\nfeat/open\nfeat/wip\n' });
      if (cmd === 'git' && args.includes('status')) return result({ stdout: '' }); // clean worktree
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        removed.push(args[2] ?? '');
        return result();
      }
      if (cmd === 'git' && args[0] === 'branch' && args[1] === '-D') {
        deleted.push(args[2] ?? '');
        return result();
      }
      if (cmd === 'gh' && args[0] === 'repo') return result({ stdout: 'o/r\n' });
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        // feat/done → closed PR #1; feat/wip → no PRs.
        const headIdx = args.indexOf('--head');
        const head = args[headIdx + 1];
        if (head === 'feat/done') return result({ stdout: JSON.stringify([{ number: 1 }]) });
        return result({ stdout: '[]' });
      }
      return undefined;
    });

    const out = await runCleanup({ cwd: '/repo', log: vi.fn() });

    expect(removed).toEqual(['/repo/.git-worktrees/done']);
    expect(deleted).toEqual(['feat/done']);
    expect(out.worktreesRemoved).toBe(1);
    expect(out.branchesDeleted).toBe(1);
    // feat/open is the current branch (kept), feat/wip has no PR (kept).
    expect(out.branchesKept).toBe(2);
  });

  it('keeps a dirty closed-PR worktree and its branch — no force-remove, no branch delete', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [] });
    fetchPrSummary.mockResolvedValue({ state: 'MERGED' });
    let removeCalled = false;
    const deleted: string[] = [];
    scriptGit((cmd, args) => {
      if (cmd === 'git' && args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD')
        return result({ stdout: 'refs/remotes/origin/main\n' });
      if (cmd === 'git' && args[0] === 'symbolic-ref') return result({ stdout: 'main\n' });
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list')
        return result({
          stdout: [
            'worktree /repo\nbranch refs/heads/main',
            'worktree /repo/.git-worktrees/dirty\nbranch refs/heads/feat/dirty',
          ].join('\n\n'),
        });
      if (cmd === 'git' && args[0] === 'branch' && args.includes('--format=%(refname:short)'))
        return result({ stdout: 'feat/dirty\n' });
      if (cmd === 'git' && args.includes('status')) return result({ stdout: ' M file.ts\n' });
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        removeCalled = true;
        return result();
      }
      if (cmd === 'git' && args[0] === 'branch' && args[1] === '-D') {
        deleted.push(args[2] ?? '');
        return result();
      }
      if (cmd === 'gh' && args[0] === 'repo') return result({ stdout: 'o/r\n' });
      if (cmd === 'gh' && args[0] === 'pr')
        return result({ stdout: JSON.stringify([{ number: 9 }]) });
      return undefined;
    });

    const out = await runCleanup({ cwd: '/repo', log: vi.fn() });
    expect(removeCalled).toBe(false);
    expect(out.worktreesKept).toBe(1);
    expect(out.worktreesRemoved).toBe(0);
    // The branch is checked out in the kept worktree — Phase 2 must skip it, not
    // attempt `git branch -D` (which git refuses), and count it as kept.
    expect(deleted).toEqual([]);
    expect(out.branchesKept).toBe(1);
  });

  it('counts a failed worktree removal as kept and skips its branch in Phase 2', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [] });
    fetchPrSummary.mockResolvedValue({ state: 'MERGED' });
    const deleted: string[] = [];
    scriptGit((cmd, args) => {
      if (cmd === 'git' && args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD')
        return result({ stdout: 'refs/remotes/origin/main\n' });
      if (cmd === 'git' && args[0] === 'symbolic-ref') return result({ stdout: 'main\n' });
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list')
        return result({
          stdout: [
            'worktree /repo\nbranch refs/heads/main',
            'worktree /repo/.git-worktrees/stuck\nbranch refs/heads/feat/stuck',
          ].join('\n\n'),
        });
      if (cmd === 'git' && args[0] === 'branch' && args.includes('--format=%(refname:short)'))
        return result({ stdout: 'feat/stuck\n' });
      if (cmd === 'git' && args.includes('status')) return result({ stdout: '' }); // clean
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove')
        return result({ code: 1, stderr: 'worktree is locked' }); // removal fails
      if (cmd === 'git' && args[0] === 'branch' && args[1] === '-D') {
        deleted.push(args[2] ?? '');
        return result();
      }
      if (cmd === 'gh' && args[0] === 'repo') return result({ stdout: 'o/r\n' });
      if (cmd === 'gh' && args[0] === 'pr')
        return result({ stdout: JSON.stringify([{ number: 3 }]) });
      return undefined;
    });

    const out = await runCleanup({ cwd: '/repo', log: vi.fn() });
    // A failed `git worktree remove` counts as kept (not neither counter)…
    expect(out.worktreesKept).toBe(1);
    expect(out.worktreesRemoved).toBe(0);
    // …and its branch is still checked out there, so Phase 2 skips the delete.
    expect(deleted).toEqual([]);
    expect(out.branchesKept).toBe(1);
  });

  it('deletes a stale open-PR branch and its worktree, keeping a fresh one', async () => {
    // Both branches have an open PR, so only staleness distinguishes them.
    gatherRepoStatus.mockResolvedValue({
      openPrs: [{ headRefName: 'feat/stale' }, { headRefName: 'feat/fresh' }],
    });
    const NOW = 1_700_000_000_000;
    const DAY = 86_400_000;
    const removed: string[] = [];
    const deleted: string[] = [];
    scriptGit((cmd, args) => {
      if (cmd === 'git' && args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD')
        return result({ stdout: 'refs/remotes/origin/main\n' });
      if (cmd === 'git' && args[0] === 'symbolic-ref') return result({ stdout: 'main\n' });
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list')
        return result({
          stdout: [
            'worktree /repo\nbranch refs/heads/main',
            'worktree /repo/.git-worktrees/stale\nbranch refs/heads/feat/stale',
          ].join('\n\n'),
        });
      if (cmd === 'git' && args[0] === 'branch' && args.includes('--format=%(refname:short)'))
        return result({ stdout: 'feat/stale\nfeat/fresh\n' });
      if (cmd === 'git' && args[0] === 'log') {
        const ageDays = args[args.length - 1] === 'feat/stale' ? 45 : 3;
        return result({ stdout: `${(NOW - ageDays * DAY) / 1000}\n` });
      }
      if (cmd === 'git' && args.includes('status')) return result({ stdout: '' }); // clean
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        removed.push(args[2] ?? '');
        return result();
      }
      if (cmd === 'git' && args[0] === 'branch' && args[1] === '-D') {
        deleted.push(args[2] ?? '');
        return result();
      }
      if (cmd === 'gh' && args[0] === 'repo') return result({ stdout: 'o/r\n' });
      return undefined;
    });

    const out = await runCleanup({ cwd: '/repo', log: vi.fn(), now: NOW });

    expect(removed).toEqual(['/repo/.git-worktrees/stale']);
    expect(deleted).toEqual(['feat/stale']);
    expect(out.worktreesRemoved).toBe(1);
    expect(out.branchesDeleted).toBe(1);
    expect(out.branchesKept).toBe(1); // feat/fresh — recent commit, open PR
  });

  it('reports nothing to clean when there are no worktrees or extra branches', async () => {
    gatherRepoStatus.mockResolvedValue({ openPrs: [] });
    scriptGit((cmd, args) => {
      if (cmd === 'git' && args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD')
        return result({ stdout: 'refs/remotes/origin/main\n' });
      if (cmd === 'git' && args[0] === 'symbolic-ref') return result({ stdout: 'main\n' });
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list')
        return result({ stdout: '' });
      if (cmd === 'git' && args[0] === 'branch') return result({ stdout: 'main\n' });
      return undefined;
    });
    const log = vi.fn();
    const out = await runCleanup({ cwd: '/repo', log });
    expect(out).toEqual({
      worktreesRemoved: 0,
      worktreesKept: 0,
      branchesDeleted: 0,
      branchesKept: 0,
    });
    expect(log.mock.calls.some((c) => String(c[0]).includes('Nothing to clean up'))).toBe(true);
  });
});
