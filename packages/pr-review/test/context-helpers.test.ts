import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock both real-world boundaries: the github client (its own gh calls) and the
// runtime subprocess used for the gap reads. Hermetic, deny-by-default — no `gh`
// ever runs (the spirit of dotfiles' _hermetic.py).
const boundedRun = vi.fn();
const fetchPrSummary = vi.fn();
const computePrDiff = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));
vi.mock('@rmartz/github', () => ({ fetchPrSummary, computePrDiff }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const {
  fetchSummary,
  diffSinceLastReview,
  listPrReviews,
  lastAuthoritativeReview,
  listIssueComments,
  extractScreenshotUrls,
} = await import('../src/context-helpers.js');

beforeEach(() => {
  boundedRun.mockReset();
  fetchPrSummary.mockReset();
  computePrDiff.mockReset();
});

describe('re-exports', () => {
  it('fetchSummary delegates to the github client', async () => {
    fetchPrSummary.mockResolvedValueOnce({ number: 7 });
    const s = await fetchSummary('o/r', 7);
    expect(s).toEqual({ number: 7 });
    expect(fetchPrSummary).toHaveBeenCalledWith('o/r', 7);
  });

  it('diffSinceLastReview delegates to computePrDiff', async () => {
    computePrDiff.mockResolvedValueOnce('=== a.ts ===\n');
    const d = await diffSinceLastReview('base', 'head', 'o/r');
    expect(d).toContain('a.ts');
    expect(computePrDiff).toHaveBeenCalledWith('base', 'head', 'o/r', {});
  });
});

describe('listPrReviews', () => {
  it('parses, sorts most-recent-first, and never runs on parse failure', async () => {
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
    expect(reviews[0]?.submittedAt).toBe('2026-02-01T00:00:00Z');
  });

  it('soft-fails to [] when gh fails', async () => {
    boundedRun.mockResolvedValueOnce(result({ code: 1, stderr: 'boom' }));
    expect(await listPrReviews('o/r', 5)).toEqual([]);
  });

  it('soft-fails to [] when boundedRun throws', async () => {
    boundedRun.mockRejectedValueOnce(new Error('spawn ENOENT'));
    expect(await listPrReviews('o/r', 5)).toEqual([]);
  });
});

describe('lastAuthoritativeReview', () => {
  const mk = (user: string, submittedAt: string) => ({
    id: 1,
    state: 'APPROVED',
    submittedAt,
    commitId: null,
    user,
  });

  it('returns the most recent non-advisory review', () => {
    const reviews = [
      mk('copilot-pull-request-reviewer[bot]', '2026-03-01T00:00:00Z'),
      mk('rmartz', '2026-02-01T00:00:00Z'),
    ];
    expect(lastAuthoritativeReview(reviews)?.user).toBe('rmartz');
  });

  it('returns null for a Copilot-only history', () => {
    const reviews = [
      mk('copilot-pull-request-reviewer[bot]', '2026-03-01T00:00:00Z'),
      mk('copilot-swe-agent', '2026-02-01T00:00:00Z'),
    ];
    expect(lastAuthoritativeReview(reviews)).toBeNull();
  });
});

describe('listIssueComments', () => {
  it('maps id/author/body and soft-fails to []', async () => {
    boundedRun.mockResolvedValueOnce(
      result({
        stdout: JSON.stringify([{ id: 9, user: { login: 'rmartz' }, body: 'hi' }]),
      }),
    );
    const comments = await listIssueComments('o/r', 3);
    expect(comments).toEqual([{ id: 9, author: 'rmartz', body: 'hi' }]);
  });

  it('returns [] on failure', async () => {
    boundedRun.mockResolvedValueOnce(result({ code: 1 }));
    expect(await listIssueComments('o/r', 3)).toEqual([]);
  });
});

describe('extractScreenshotUrls', () => {
  it('extracts and dedupes uploaded-image URLs order-stably', () => {
    const a = 'https://github.com/user-attachments/assets/aaa';
    const b = 'https://user-images.githubusercontent.com/1/bbb.png';
    const comments = [
      { id: 1, author: 'x', body: `look ![](${a}) and ![](${b})` },
      { id: 2, author: 'y', body: `again ![](${a})` },
    ];
    expect(extractScreenshotUrls(comments)).toEqual([a, b]);
  });

  it('returns [] when no images are present', () => {
    expect(extractScreenshotUrls([{ id: 1, author: 'x', body: 'no images here' }])).toEqual([]);
  });
});
