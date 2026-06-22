import { describe, it, expect, vi } from 'vitest';

// `gh api graphql` is a real-world boundary — mock the runtime so the test is
// hermetic. Each call returns the GraphQL envelope the client expects.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (data: unknown) => ({
  stdout: JSON.stringify({ data }),
  stderr: '',
  code: 0,
  timedOut: false,
});

const { findDiscussionByTitle, addComment } = await import('../src/discussions.js');

describe('findDiscussionByTitle', () => {
  it('returns the exact-title match and ignores near matches', async () => {
    boundedRun.mockResolvedValueOnce(
      ok({
        search: {
          nodes: [
            { id: 'D_1', number: 1, url: 'u1', title: 'Flaky tests' },
            { id: 'D_2', number: 2, url: 'u2', title: 'Flaky tests in CI' },
          ],
        },
      }),
    );
    const found = await findDiscussionByTitle('rmartz/ai', 'Flaky tests');
    expect(found?.id).toBe('D_1');
  });

  it('returns null when nothing matches', async () => {
    boundedRun.mockResolvedValueOnce(ok({ search: { nodes: [] } }));
    expect(await findDiscussionByTitle('rmartz/ai', 'nope')).toBeNull();
  });
});

describe('addComment', () => {
  it('unwraps the created comment', async () => {
    boundedRun.mockResolvedValueOnce(
      ok({ addDiscussionComment: { comment: { id: 'DC_1', url: 'curl' } } }),
    );
    const comment = await addComment('D_1', 'an approach that worked');
    expect(comment).toEqual({ id: 'DC_1', url: 'curl' });
  });
});
