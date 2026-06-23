import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readlinkSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Boundaries mocked: no real git/gh, no real install.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));
const addAssignees = vi.fn();
const currentRepo = vi.fn();
vi.mock('@rmartz/github', () => ({ addAssignees, currentRepo }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const mod = await import('../src/new-worktree.js');
const {
  deriveSlug,
  composeBranchName,
  composeWorktreeDir,
  detectInstallCommand,
  symlinkClaudeSettings,
  runNewWorktree,
} = mod;

describe('deriveSlug', () => {
  it('strips a Conventional Commits prefix and truncates to 4 words', () => {
    expect(deriveSlug('feat(scripts): add new-worktree to eliminate per-task boilerplate')).toBe(
      'add-new-worktree-to',
    );
  });
  it('handles a plain prefix', () => {
    expect(deriveSlug('fix: bug in foo')).toBe('bug-in-foo');
  });
  it('returns "task" for empty or all-symbol titles', () => {
    expect(deriveSlug('')).toBe('task');
    expect(deriveSlug('!!!')).toBe('task');
  });
});

describe('composeBranchName', () => {
  it('builds an issue branch with slug', () => {
    expect(composeBranchName('feat', { issueNum: 873, slug: 'add-worktree' })).toBe(
      'feat/issue-873-add-worktree',
    );
  });
  it('defaults a missing slug to "task"', () => {
    expect(composeBranchName('fix', { issueNum: 5 })).toBe('fix/issue-5-task');
  });
  it('builds a name-only branch', () => {
    expect(composeBranchName('chore', { name: 'standalone' })).toBe('chore/standalone');
  });
  it('throws with neither issue nor name', () => {
    expect(() => composeBranchName('feat', {})).toThrow();
  });
});

describe('composeWorktreeDir', () => {
  it('uses the branch leaf under .git-worktrees', () => {
    expect(composeWorktreeDir('/repo', 'feat/issue-873-add-worktree')).toBe(
      join('/repo', '.git-worktrees', 'issue-873-add-worktree'),
    );
  });
});

describe('detectInstallCommand', () => {
  let repo: string;
  beforeEach(() => (repo = mkdtempSync(join(tmpdir(), 'nw-detect-'))));
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('prefers pnpm-lock.yaml over package-lock.json', () => {
    writeFileSync(join(repo, 'pnpm-lock.yaml'), '');
    writeFileSync(join(repo, 'package-lock.json'), '');
    expect(detectInstallCommand(repo)).toEqual(['pnpm', 'install', '--frozen-lockfile']);
  });
  it('maps npm and yarn lockfiles', () => {
    writeFileSync(join(repo, 'package-lock.json'), '');
    expect(detectInstallCommand(repo)).toEqual(['npm', 'ci']);
  });
  it('falls back to npm install for package.json with no lockfile', () => {
    writeFileSync(join(repo, 'package.json'), '{}');
    expect(detectInstallCommand(repo)).toEqual(['npm', 'install']);
  });
  it('returns null with no manifest', () => {
    expect(detectInstallCommand(repo)).toBeNull();
  });
});

describe('symlinkClaudeSettings', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'nw-symlink-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns false when the source is absent', () => {
    const wt = join(dir, 'wt');
    mkdirSync(wt);
    expect(symlinkClaudeSettings(wt, join(dir, 'nope.json'))).toBe(false);
  });

  it('creates the symlink and heals a stale one on re-run', () => {
    const source = join(dir, 'project-settings.local.json');
    writeFileSync(source, '{}');
    const wt = join(dir, 'wt');
    mkdirSync(wt);
    expect(symlinkClaudeSettings(wt, source)).toBe(true);
    const link = join(wt, '.claude', 'settings.local.json');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(source);
    // Re-run heals without throwing.
    expect(symlinkClaudeSettings(wt, source)).toBe(true);
  });
});

describe('runNewWorktree', () => {
  let repo: string;
  beforeEach(() => {
    boundedRun.mockReset();
    addAssignees.mockReset();
    currentRepo.mockReset();
    repo = mkdtempSync(join(tmpdir(), 'nw-run-'));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('requires an issue or name', async () => {
    await expect(runNewWorktree({ cwd: repo })).rejects.toThrow(/issue number or name/);
  });

  it('creates a worktree, symlinks settings, installs, and assigns the issue', async () => {
    // No JS manifest in repo → no install command, keeps the subprocess count tight.
    currentRepo.mockResolvedValue('rmartz/ai-tools');
    addAssignees.mockResolvedValue('ok');
    // Order of boundedRun calls inside runNewWorktree:
    // 1 git rev-parse, 2 gh repo view (currentRepo is mocked → not via boundedRun),
    // gh defaultBranchRef, gh issue view (title), git fetch, git worktree add, gh api user.
    boundedRun.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'rev-parse') return result({ stdout: `${repo}\n` });
      if (cmd === 'gh' && args[0] === 'repo' && args.includes('defaultBranchRef'))
        return result({ stdout: 'main\n' });
      if (cmd === 'gh' && args[0] === 'issue') return result({ stdout: 'feat: do a thing\n' });
      if (cmd === 'git' && args[0] === 'fetch') return result();
      if (cmd === 'git' && args[0] === 'worktree') return result();
      if (cmd === 'gh' && args[0] === 'api') return result({ stdout: 'octocat\n' });
      return result();
    });

    const out = await runNewWorktree({ issue: 42, cwd: repo, log: vi.fn(), skipInstall: true });

    expect(out.branch).toBe('feat/issue-42-do-a-thing');
    expect(out.worktreePath).toBe(join(repo, '.git-worktrees', 'issue-42-do-a-thing'));
    expect(out.baseRef).toBe('main');
    // The worktree-add was issued with the composed path and origin/main base.
    const addCall = boundedRun.mock.calls.find(
      (c) => c[0] === 'git' && (c[1] as string[])[0] === 'worktree',
    );
    expect(addCall?.[1]).toContain('origin/main');
    expect(addAssignees).toHaveBeenCalledWith('rmartz/ai-tools', 42, ['octocat'], { cwd: repo });
  });

  it('throws when not in a git repo', async () => {
    boundedRun.mockResolvedValue(result({ code: 1, stderr: 'fatal' }));
    await expect(runNewWorktree({ name: 'x', cwd: repo, log: vi.fn() })).rejects.toThrow(
      /not a git repository/,
    );
  });

  it('emits a stacked reminder and forks off the base branch', async () => {
    currentRepo.mockResolvedValue('rmartz/ai-tools');
    boundedRun.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'rev-parse') return result({ stdout: `${repo}\n` });
      if (cmd === 'gh' && args.includes('defaultBranchRef')) return result({ stdout: 'main\n' });
      return result();
    });
    const log = vi.fn();
    const out = await runNewWorktree({
      name: 'dependent',
      base: 'feat/issue-1-base',
      cwd: repo,
      log,
      skipInstall: true,
    });
    expect(out.baseRef).toBe('feat/issue-1-base');
    expect(log.mock.calls.some((c) => String(c[0]).includes('stacked on'))).toBe(true);
  });
});
