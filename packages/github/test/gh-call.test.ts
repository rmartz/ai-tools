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

const { ghCall, issueNumber } = await import('../src/gh-call.js');

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
