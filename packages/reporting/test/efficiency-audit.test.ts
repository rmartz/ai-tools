import { describe, it, expect, vi, beforeEach } from 'vitest';

const currentRepo = vi.fn();
vi.mock('@rmartz/github', () => ({ currentRepo }));

// agent-runtime is only used by the real ghReader, which the tests never hit
// (a stub GhReader is injected), but the import must resolve under mocking.
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun: vi.fn() }));

const { auditPrEfficiency } = await import('../src/efficiency-audit.js');
const { deriveCounts } = await import('../src/efficiency-derive.js');
import type { GhReader } from '../src/efficiency-derive.js';

beforeEach(() => {
  currentRepo.mockReset();
});

const REVIEW_BODY = 'verdict <!-- skill-meta: {"skill":"review"} -->';

/** Build a GhReader stub from in-memory fixtures. */
function reader(fixtures: {
  commits?: unknown[];
  reviews?: unknown[];
  checkRuns?: Record<string, unknown[]>;
}): GhReader {
  return {
    commits: async () => (fixtures.commits ?? []) as never,
    reviews: async () => (fixtures.reviews ?? []) as never,
    checkRuns: async (_repo, sha) => ((fixtures.checkRuns ?? {})[sha] ?? []) as never,
  };
}

describe('deriveCounts', () => {
  it('counts review iterations and redundant reviews from skill-meta reviews', async () => {
    const counts = await deriveCounts(
      'rmartz/app',
      1,
      reader({
        reviews: [
          { body: REVIEW_BODY, commit_id: 'aaa', submitted_at: '2026-01-01T00:00:00Z' },
          { body: REVIEW_BODY, commit_id: 'aaa', submitted_at: '2026-01-02T00:00:00Z' },
          {
            body: 'human review, no marker',
            commit_id: 'bbb',
            submitted_at: '2026-01-03T00:00:00Z',
          },
        ],
      }),
    );
    expect(counts.reviewIterations).toBe(2); // only skill-meta marked
    expect(counts.redundantReviews).toBe(1); // two /review on same SHA aaa
  });

  it('counts author fix-review commits, skipping merge and web-flow commits', async () => {
    const counts = await deriveCounts(
      'rmartz/app',
      1,
      reader({
        commits: [
          { sha: 'c1', parents: [{ sha: 'p0' }], author: { login: 'reed' } },
          { sha: 'c2', parents: [{ sha: 'p1' }], author: { login: 'reed' } },
          { sha: 'm1', parents: [{ sha: 'a' }, { sha: 'b' }], author: { login: 'reed' } }, // merge
          { sha: 'w1', parents: [{ sha: 'p2' }], author: { login: 'web-flow' } }, // browser
        ],
      }),
    );
    expect(counts.fixReviewIterations).toBe(2); // c1, c2 only
    expect(counts.mergeAttempts).toBe(2); // 1 merge commit + 1 for the PR merge
  });

  it('classifies preventable failures, flaky retries, and ci runs from GA check-runs', async () => {
    const ga = (name: string, conclusion: string | null) => ({
      name,
      conclusion,
      app: { slug: 'github-actions' },
    });
    const counts = await deriveCounts(
      'rmartz/app',
      1,
      reader({
        commits: [{ sha: 'c1', parents: [{ sha: 'p0' }], author: { login: 'reed' } }],
        checkRuns: {
          c1: [
            ga('Lint', 'failure'), // preventable failure
            ga('Typecheck', 'failure'), // flaky (also passes below)
            ga('Typecheck', 'success'),
            ga('e2e', 'failure'), // excluded — not counted
            { name: 'other-app', conclusion: 'failure', app: { slug: 'circleci' } }, // non-GA ignored
          ],
        },
      }),
    );
    expect(counts.preventableCiFailures).toBe(1); // Lint
    expect(counts.flakyRetries).toBe(1); // Typecheck failed then passed
    expect(counts.ciRuns).toBe(3); // Lint, Typecheck, e2e (distinct GA names)
  });

  it('returns all-zero counts (mergeAttempts 1) for an empty PR', async () => {
    const counts = await deriveCounts('rmartz/app', 1, reader({}));
    expect(counts).toEqual({
      reviewIterations: 0,
      fixReviewIterations: 0,
      ciRuns: 0,
      preventableCiFailures: 0,
      redundantReviews: 0,
      flakyRetries: 0,
      mergeAttempts: 1,
    });
  });
});

describe('auditPrEfficiency', () => {
  it('emits the EfficiencyEvent shape with derived counts and resolved repo', async () => {
    currentRepo.mockResolvedValue('rmartz/app');
    const event = await auditPrEfficiency(7, { reader: reader({}) });
    expect(event.pr).toBe(7);
    expect(event.sourceRepo).toBe('rmartz/app');
    expect(event.counts.mergeAttempts).toBe(1);
    expect(event.durationsMs).toBeUndefined();
    expect(event.mergedAt).toBeUndefined();
  });

  it('uses an explicit repo without calling currentRepo', async () => {
    const event = await auditPrEfficiency(7, { repo: 'rmartz/given', reader: reader({}) });
    expect(event.sourceRepo).toBe('rmartz/given');
    expect(currentRepo).not.toHaveBeenCalled();
  });

  it('merges partial durationsMs enrichment, defaulting missing buckets to 0', async () => {
    const event = await auditPrEfficiency(7, {
      repo: 'rmartz/app',
      reader: reader({}),
      durationsMs: { claude: 1000, externalWait: 500 },
    });
    expect(event.durationsMs).toEqual({
      claude: 1000,
      active: 0,
      scheduleWait: 0,
      externalWait: 500,
    });
  });

  it('attaches mergedAt verbatim when supplied', async () => {
    const event = await auditPrEfficiency(7, {
      repo: 'rmartz/app',
      reader: reader({}),
      mergedAt: '2026-06-23T00:00:00Z',
    });
    expect(event.mergedAt).toBe('2026-06-23T00:00:00Z');
  });

  it('throws when the repo cannot be resolved', async () => {
    currentRepo.mockResolvedValue(null);
    await expect(auditPrEfficiency(7, { reader: reader({}) })).rejects.toThrow(
      'could not determine repo',
    );
  });
});
