import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh api graphql` is a real-world boundary — mock the runtime so the test is
// hermetic. Each call returns the GraphQL envelope the client expects.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

beforeEach(() => boundedRun.mockReset());

const ok = (data: unknown) => ({
  stdout: JSON.stringify({ data }),
  stderr: '',
  code: 0,
  timedOut: false,
});

const {
  findDiscussionByTitle,
  addComment,
  getRepositoryId,
  listComments,
  getDiscussion,
  findOrCreateDiscussion,
} = await import('../src/discussions.js');

const rawComment = (over: Record<string, unknown> = {}) => ({
  id: 'DC_1',
  url: 'curl',
  body: 'an approach',
  createdAt: '2026-06-25T00:00:00Z',
  isAnswer: false,
  upvoteCount: 2,
  author: { login: 'octocat' },
  ...over,
});

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

describe('getRepositoryId', () => {
  it('returns the repo node id', async () => {
    boundedRun.mockResolvedValueOnce(ok({ repository: { id: 'R_1' } }));
    expect(await getRepositoryId('rmartz/ai')).toBe('R_1');
  });

  it('throws when the repo is absent', async () => {
    boundedRun.mockResolvedValueOnce(ok({ repository: null }));
    await expect(getRepositoryId('rmartz/nope')).rejects.toThrow('repository not found');
  });
});

describe('listComments', () => {
  it('maps the comment detail fields (author login flattened)', async () => {
    boundedRun.mockResolvedValueOnce(
      ok({
        node: { comments: { nodes: [rawComment(), rawComment({ author: null, isAnswer: true })] } },
      }),
    );
    const comments = await listComments('D_1');
    expect(comments[0]).toEqual({
      id: 'DC_1',
      url: 'curl',
      body: 'an approach',
      authorLogin: 'octocat',
      createdAt: '2026-06-25T00:00:00Z',
      isAnswer: false,
      upvoteCount: 2,
    });
    expect(comments[1]).toMatchObject({ authorLogin: null, isAnswer: true });
  });

  it('returns [] when the node is absent', async () => {
    boundedRun.mockResolvedValueOnce(ok({ node: null }));
    expect(await listComments('D_x')).toEqual([]);
  });
});

describe('getDiscussion', () => {
  it('returns the discussion with mapped comments', async () => {
    boundedRun.mockResolvedValueOnce(
      ok({
        repository: {
          discussion: {
            id: 'D_1',
            number: 7,
            url: 'durl',
            title: 'Flaky tests',
            body: 'problem framing',
            comments: { nodes: [rawComment()] },
          },
        },
      }),
    );
    const d = await getDiscussion('rmartz/ai', 7);
    expect(d).toMatchObject({ id: 'D_1', number: 7, title: 'Flaky tests' });
    expect(d?.comments[0]?.authorLogin).toBe('octocat');
  });

  it('returns null when the discussion is absent', async () => {
    boundedRun.mockResolvedValueOnce(ok({ repository: { discussion: null } }));
    expect(await getDiscussion('rmartz/ai', 999)).toBeNull();
  });
});

describe('findOrCreateDiscussion', () => {
  it('returns the existing ref without creating', async () => {
    boundedRun.mockResolvedValueOnce(
      ok({ search: { nodes: [{ id: 'D_1', number: 1, url: 'u1', title: 'T' }] } }),
    );
    const ref = await findOrCreateDiscussion('rmartz/ai', 'q-a', 'T', 'body');
    expect(ref).toEqual({ id: 'D_1', number: 1, url: 'u1' });
    expect(boundedRun).toHaveBeenCalledTimes(1); // find only — no create path
  });

  it('resolves the category by slug and creates when none matches', async () => {
    boundedRun
      .mockResolvedValueOnce(ok({ search: { nodes: [] } })) // find → none
      .mockResolvedValueOnce(
        ok({
          repository: {
            discussionCategories: { nodes: [{ id: 'C_1', name: 'Q&A', slug: 'q-a' }] },
          },
        }),
      )
      .mockResolvedValueOnce(ok({ repository: { id: 'R_1' } })) // getRepositoryId
      .mockResolvedValueOnce(
        ok({ createDiscussion: { discussion: { id: 'D_9', number: 9, url: 'u9' } } }),
      );
    const ref = await findOrCreateDiscussion('rmartz/ai', 'q-a', 'New', 'framing');
    expect(ref).toEqual({ id: 'D_9', number: 9, url: 'u9' });
  });

  it('throws when the category slug is unknown', async () => {
    boundedRun.mockResolvedValueOnce(ok({ search: { nodes: [] } })).mockResolvedValueOnce(
      ok({
        repository: {
          discussionCategories: { nodes: [{ id: 'C_1', name: 'General', slug: 'general' }] },
        },
      }),
    );
    await expect(findOrCreateDiscussion('rmartz/ai', 'q-a', 'New', 'framing')).rejects.toThrow(
      'discussion category not found',
    );
  });
});
