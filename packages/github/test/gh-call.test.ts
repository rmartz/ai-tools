import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic
// (deny-by-default subprocess/network, the spirit of dotfiles' _hermetic.py).
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { ghCall, issueNumber, resolveProjectRef } = await import('../src/gh-call.js');

const noSleep = vi.fn(async () => {});

describe('ghCall', () => {
  beforeEach(() => {
    boundedRun.mockReset();
    noSleep.mockClear();
  });

  it('returns primary stdout on success without touching the fallback', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'ok' }));
    const out = await ghCall({ argv: ['gh', 'api', 'x'] }, { argv: ['gh', 'issue', 'list'] });
    expect(out).toBe('ok');
    expect(boundedRun).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure with backoff, then succeeds', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stderr: 'boom', code: 1 }))
      .mockResolvedValueOnce(result({ stdout: 'recovered' }));
    const out = await ghCall({ argv: ['gh', 'api', 'x'] }, null, { sleep: noSleep });
    expect(out).toBe('recovered');
    expect(noSleep).toHaveBeenCalledOnce();
  });

  it('skips retries and switches to the fallback on a rate-limit error', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stderr: 'API rate limit exceeded', code: 1 }))
      .mockResolvedValueOnce(result({ stdout: 'via-graphql' }));
    const out = await ghCall(
      { argv: ['gh', 'api', 'x'] },
      { argv: ['gh', 'issue', 'list'] },
      {
        sleep: noSleep,
      },
    );
    expect(out).toBe('via-graphql');
    // First transport rate-limited (no retry sleeps), straight to fallback.
    expect(noSleep).not.toHaveBeenCalled();
    expect(boundedRun).toHaveBeenCalledTimes(2);
  });

  it('soft-fails to null when both transports are exhausted', async () => {
    boundedRun.mockResolvedValue(result({ stderr: 'nope', code: 1 }));
    const out = await ghCall(
      { argv: ['gh', 'api', 'x'] },
      { argv: ['gh', 'issue', 'list'] },
      {
        sleep: noSleep,
      },
    );
    expect(out).toBeNull();
  });

  it('treats a boundedRun rejection as a failed attempt', async () => {
    boundedRun.mockRejectedValue(new Error('spawn ENOENT'));
    const out = await ghCall({ argv: ['gh', 'api', 'x'] }, null, { sleep: noSleep });
    expect(out).toBeNull();
  });
});

describe('resolveProjectRef', () => {
  beforeEach(() => boundedRun.mockReset());

  const view = (over: { nameWithOwner?: string; branch?: string | null } = {}) =>
    JSON.stringify({
      nameWithOwner: over.nameWithOwner ?? 'rmartz/trip-planner',
      defaultBranchRef: over.branch === null ? null : { name: over.branch ?? 'main' },
    });

  it('resolves the working repo, its default branch, and that branch HEAD sha', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stdout: view() }))
      .mockResolvedValueOnce(result({ stdout: 'a1b2c3d4e5f60718\n' }));
    expect(await resolveProjectRef()).toEqual({
      repo: 'rmartz/trip-planner',
      branch: 'main',
      sha: 'a1b2c3d4e5f60718',
    });
  });

  it('queries the named repo (and its commits) when a repo is given', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stdout: view({ nameWithOwner: 'rmartz/ai' }) }))
      .mockResolvedValueOnce(result({ stdout: 'deadbeefcafe\n' }));
    const ref = await resolveProjectRef('rmartz/ai');
    expect(ref?.repo).toBe('rmartz/ai');
    expect(boundedRun.mock.calls[0]?.[1]).toContain('rmartz/ai');
    expect(boundedRun.mock.calls[1]?.[1]).toContain('repos/rmartz/ai/commits/main');
  });

  it('soft-fails to null when the repo view fails', async () => {
    boundedRun.mockResolvedValue(result({ stderr: 'nope', code: 1 }));
    expect(await resolveProjectRef(undefined, { sleep: noSleep })).toBeNull();
  });

  it('soft-fails to null when the default branch is absent', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: view({ branch: null }) }));
    expect(await resolveProjectRef()).toBeNull();
    expect(boundedRun).toHaveBeenCalledTimes(1); // never reaches the commits call
  });

  it('soft-fails to null when the HEAD sha cannot be resolved', async () => {
    boundedRun
      .mockResolvedValueOnce(result({ stdout: view() }))
      .mockResolvedValue(result({ stderr: 'nope', code: 1 }));
    expect(await resolveProjectRef(undefined, { sleep: noSleep })).toBeNull();
  });
});

describe('issueNumber', () => {
  it('passes through a bare number', () => {
    expect(issueNumber(42)).toBe('42');
    expect(issueNumber('42')).toBe('42');
  });

  it('extracts from issue and pull URLs', () => {
    expect(issueNumber('https://github.com/o/r/issues/7')).toBe('7');
    expect(issueNumber('https://github.com/o/r/pull/9')).toBe('9');
  });

  it('returns null for an unparseable reference', () => {
    expect(issueNumber('not-a-ref')).toBeNull();
  });
});
