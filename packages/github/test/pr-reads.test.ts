import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic
// (deny-by-default network/subprocess, the spirit of dotfiles' _hermetic.py).
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { listPrReviews, listIssueComments } = await import('../src/pr-reads.js');

// No-op sleeper so ghCall's backoff retries don't add real delay on failure.
const noWait = { sleep: async () => {} };

beforeEach(() => {
  boundedRun.mockReset();
});

describe('listPrReviews', () => {
  it('parses and sorts most-recent-first', async () => {
    boundedRun.mockResolvedValueOnce(
      result({
        stdout: JSON.stringify([
          {
            id: 1,
            state: 'APPROVED',
            submitted_at: '2026-01-01T00:00:00Z',
            commit_id: 'a',
            user: 'old',
          },
          {
            id: 2,
            state: 'COMMENTED',
            submitted_at: '2026-02-01T00:00:00Z',
            commit_id: 'b',
            user: 'new',
          },
        ]),
      }),
    );
    const reviews = await listPrReviews('o/r', 5);
    expect(reviews.map((r) => r.id)).toEqual([2, 1]);
    expect(reviews[0]).toEqual({
      id: 2,
      state: 'COMMENTED',
      submittedAt: '2026-02-01T00:00:00Z',
      commitId: 'b',
      user: 'new',
    });
  });

  it('hits the REST reviews endpoint', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: '[]' }));
    await listPrReviews('o/r', 5);
    const [cmd, argv] = boundedRun.mock.calls[0] ?? [];
    expect(cmd).toBe('gh');
    expect(argv).toContain('repos/o/r/pulls/5/reviews');
  });

  it('tolerates a null user login', async () => {
    boundedRun.mockResolvedValueOnce(
      result({
        stdout: JSON.stringify([
          { id: 1, state: 'APPROVED', submitted_at: null, commit_id: null, user: null },
        ]),
      }),
    );
    const [review] = await listPrReviews('o/r', 5);
    expect(review?.user).toBe('');
  });

  it('soft-fails to [] when gh fails', async () => {
    boundedRun.mockResolvedValue(result({ code: 1, stderr: 'boom' }));
    expect(await listPrReviews('o/r', 5, noWait)).toEqual([]);
  });

  it('soft-fails to [] when boundedRun throws', async () => {
    boundedRun.mockRejectedValue(new Error('spawn ENOENT'));
    expect(await listPrReviews('o/r', 5, noWait)).toEqual([]);
  });

  it('soft-fails to [] on unparseable stdout', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'not json' }));
    expect(await listPrReviews('o/r', 5)).toEqual([]);
  });
});

describe('listIssueComments', () => {
  it('maps id/author/body', async () => {
    boundedRun.mockResolvedValueOnce(
      result({ stdout: JSON.stringify([{ id: 9, user: { login: 'rmartz' }, body: 'hi' }]) }),
    );
    expect(await listIssueComments('o/r', 3)).toEqual([{ id: 9, author: 'rmartz', body: 'hi' }]);
  });

  it('paginates the issue-comments endpoint', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: '[]' }));
    await listIssueComments('o/r', 3);
    const [, argv] = boundedRun.mock.calls[0] ?? [];
    expect(argv).toContain('--paginate');
    expect(argv).toContain('repos/o/r/issues/3/comments');
  });

  it('tolerates a missing user and body', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: JSON.stringify([{ id: 1, user: null }]) }));
    expect(await listIssueComments('o/r', 3)).toEqual([{ id: 1, author: '', body: '' }]);
  });

  it('soft-fails to [] when gh fails', async () => {
    boundedRun.mockResolvedValue(result({ code: 1 }));
    expect(await listIssueComments('o/r', 3, noWait)).toEqual([]);
  });
});
