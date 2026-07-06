import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });

const { createPullRequest, submitReview, mergePullRequest } = await import('../src/pr-ops.js');

describe('submitReview', () => {
  beforeEach(() => boundedRun.mockReset());

  it('POSTs the event + body to the reviews endpoint', async () => {
    boundedRun.mockResolvedValueOnce(ok('{"id":1}'));
    const out = await submitReview('r/r', 5, 'APPROVE', { body: 'lgtm' });
    expect(out).toBe('{"id":1}');
    const [, args, opts] = boundedRun.mock.calls[0];
    expect(args).toContain('repos/r/r/pulls/5/reviews');
    expect(JSON.parse(opts.input)).toEqual({ event: 'APPROVE', body: 'lgtm' });
  });

  it('returns null for an unrecognized event without calling gh', async () => {
    // @ts-expect-error — exercising the runtime guard for non-typed callers
    const out = await submitReview('r/r', 5, 'NOPE');
    expect(out).toBeNull();
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('returns null for an unparseable PR reference', async () => {
    const out = await submitReview('r/r', 'garbage', 'COMMENT');
    expect(out).toBeNull();
    expect(boundedRun).not.toHaveBeenCalled();
  });
});

describe('createPullRequest', () => {
  beforeEach(() => boundedRun.mockReset());

  it('POSTs title/head/base/body to the pulls endpoint and returns the URL', async () => {
    boundedRun.mockResolvedValueOnce(ok('https://github.com/r/r/pull/7\n'));
    const url = await createPullRequest('r/r', {
      base: 'main',
      head: 'feature',
      title: 'feat: x',
      body: 'why',
    });
    expect(url).toBe('https://github.com/r/r/pull/7');
    const [, args, opts] = boundedRun.mock.calls[0];
    expect(args).toContain('repos/r/r/pulls');
    expect(JSON.parse(opts.input)).toEqual({
      title: 'feat: x',
      head: 'feature',
      base: 'main',
      body: 'why',
    });
  });

  it('includes draft in the payload only when requested', async () => {
    boundedRun.mockResolvedValueOnce(ok('https://github.com/r/r/pull/8\n'));
    await createPullRequest('r/r', { base: 'main', head: 'f', title: 't', draft: true });
    const [, , opts] = boundedRun.mock.calls[0];
    expect(JSON.parse(opts.input)).toMatchObject({ draft: true, body: '' });
  });

  it('soft-fails to null when the create call fails', async () => {
    boundedRun.mockResolvedValue({ stdout: '', stderr: 'nope', code: 1, timedOut: false });
    const url = await createPullRequest('r/r', {
      base: 'main',
      head: 'f',
      title: 't',
      sleep: async () => {},
    });
    expect(url).toBeNull();
  });
});

describe('mergePullRequest', () => {
  beforeEach(() => boundedRun.mockReset());

  it('returns the merge commit sha', async () => {
    boundedRun.mockResolvedValueOnce(ok('abc123\n'));
    expect(await mergePullRequest('r/r', 5)).toBe('abc123');
    const [, args, opts] = boundedRun.mock.calls[0];
    expect(args).toContain('repos/r/r/pulls/5/merge');
    expect(JSON.parse(opts.input)).toEqual({ merge_method: 'squash' });
  });

  it('returns true when the merge succeeds but the sha is absent', async () => {
    boundedRun.mockResolvedValueOnce(ok('  \n'));
    expect(await mergePullRequest('r/r', 5, 'rebase')).toBe(true);
  });

  it('soft-fails to null on total failure', async () => {
    boundedRun.mockResolvedValue({ stdout: '', stderr: 'nope', code: 1, timedOut: false });
    expect(await mergePullRequest('r/r', 5, 'merge', { sleep: async () => {} })).toBeNull();
  });
});
