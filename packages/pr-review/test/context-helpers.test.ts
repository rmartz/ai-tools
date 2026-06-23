import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the github client — context-helpers is a pure composition over it, so the
// reads (summary, diff, review history, comments) are all the client's. Hermetic,
// deny-by-default: no `gh` ever runs (the spirit of dotfiles' _hermetic.py).
const fetchPrSummary = vi.fn();
const computePrDiff = vi.fn();
const listPrReviews = vi.fn();
const listIssueComments = vi.fn();
vi.mock('@rmartz/github', () => ({
  fetchPrSummary,
  computePrDiff,
  listPrReviews,
  listIssueComments,
}));

const ch = await import('../src/context-helpers.js');
const { fetchSummary, diffSinceLastReview, lastAuthoritativeReview, extractScreenshotUrls } = ch;

beforeEach(() => {
  fetchPrSummary.mockReset();
  computePrDiff.mockReset();
  listPrReviews.mockReset();
  listIssueComments.mockReset();
});

describe('re-exports delegate to the github client', () => {
  it('fetchSummary → fetchPrSummary', async () => {
    fetchPrSummary.mockResolvedValueOnce({ number: 7 });
    expect(await fetchSummary('o/r', 7)).toEqual({ number: 7 });
    expect(fetchPrSummary).toHaveBeenCalledWith('o/r', 7);
  });

  it('diffSinceLastReview → computePrDiff', async () => {
    computePrDiff.mockResolvedValueOnce('=== a.ts ===\n');
    expect(await diffSinceLastReview('base', 'head', 'o/r')).toContain('a.ts');
    expect(computePrDiff).toHaveBeenCalledWith('base', 'head', 'o/r', {});
  });

  it('listPrReviews / listIssueComments are the client functions', () => {
    expect(ch.listPrReviews).toBe(listPrReviews);
    expect(ch.listIssueComments).toBe(listIssueComments);
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
