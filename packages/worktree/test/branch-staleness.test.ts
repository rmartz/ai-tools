import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { isStale, branchCommitEpochMs, classifyStaleBranches } =
  await import('../src/branch-staleness.js');

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

beforeEach(() => boundedRun.mockReset());

describe('isStale', () => {
  it('is true past the threshold and at it, false within it', () => {
    expect(isStale(NOW - 31 * DAY, NOW, 30)).toBe(true);
    expect(isStale(NOW - 30 * DAY, NOW, 30)).toBe(true);
    expect(isStale(NOW - 10 * DAY, NOW, 30)).toBe(false);
  });

  it('treats an unknown (null) age as not stale', () => {
    expect(isStale(null, NOW, 30)).toBe(false);
  });
});

describe('branchCommitEpochMs', () => {
  it('parses the committer epoch (seconds) into milliseconds', async () => {
    boundedRun.mockResolvedValue(result({ stdout: '1699999000\n' }));
    expect(await branchCommitEpochMs('feat/a', undefined)).toBe(1699999000 * 1000);
  });

  it('returns null when git fails', async () => {
    boundedRun.mockResolvedValue(result({ code: 1, stderr: 'no such ref' }));
    expect(await branchCommitEpochMs('feat/gone', undefined)).toBeNull();
  });

  it('returns null on unparseable output', async () => {
    boundedRun.mockResolvedValue(result({ stdout: 'not-a-number\n' }));
    expect(await branchCommitEpochMs('feat/x', undefined)).toBeNull();
  });
});

describe('classifyStaleBranches', () => {
  it('returns only the branches whose latest commit is older than the threshold', async () => {
    // classifyStaleBranches queries branches in iteration order, one git call each.
    boundedRun
      .mockResolvedValueOnce(result({ stdout: `${(NOW - 40 * DAY) / 1000}\n` })) // feat/old
      .mockResolvedValueOnce(result({ stdout: `${(NOW - 5 * DAY) / 1000}\n` })); // feat/fresh
    const stale = await classifyStaleBranches(['feat/old', 'feat/fresh'], undefined, NOW, 30);
    expect([...stale]).toEqual(['feat/old']);
  });
});
