import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });
const fail = { stdout: '', stderr: 'boom', code: 1, timedOut: false };

const { resolveThread, dismissThread } = await import('../src/threads.js');

const resolved = (v: boolean) =>
  ok(JSON.stringify({ data: { resolveReviewThread: { thread: { isResolved: v } } } }));
const lookup = ok(
  JSON.stringify({
    data: {
      node: {
        comments: { nodes: [{ databaseId: 555 }] },
        pullRequest: { number: 9, repository: { nameWithOwner: 'r/r' } },
      },
    },
  }),
);

describe('resolveThread', () => {
  beforeEach(() => boundedRun.mockReset());

  it('returns true when the mutation reports the thread resolved', async () => {
    boundedRun.mockResolvedValueOnce(resolved(true));
    expect(await resolveThread('PRRT_x')).toBe(true);
  });

  it('returns false on an API failure', async () => {
    boundedRun.mockResolvedValueOnce(fail);
    expect(await resolveThread('PRRT_x')).toBe(false);
  });

  it('does not retry (single-shot)', async () => {
    boundedRun.mockResolvedValueOnce(fail);
    await resolveThread('PRRT_x');
    expect(boundedRun).toHaveBeenCalledTimes(1);
  });
});

describe('dismissThread', () => {
  beforeEach(() => boundedRun.mockReset());

  it('looks up, replies to the first comment, then resolves → ok', async () => {
    boundedRun
      .mockResolvedValueOnce(lookup) // lookup
      .mockResolvedValueOnce(ok('{}')) // reply POST
      .mockResolvedValueOnce(resolved(true)); // resolve
    expect(await dismissThread('PRRT_x', 'intentional — see docs')).toBe('ok');
    const replyArgs = boundedRun.mock.calls[1][1] as string[];
    expect(replyArgs).toContain('repos/r/r/pulls/9/comments/555/replies');
    expect(replyArgs).toContain('body=intentional — see docs');
  });

  it('returns reply_only when the reply posts but resolve fails', async () => {
    boundedRun
      .mockResolvedValueOnce(lookup)
      .mockResolvedValueOnce(ok('{}'))
      .mockResolvedValueOnce(fail);
    expect(await dismissThread('PRRT_x', 'note')).toBe('reply_only');
  });

  it('returns failed and skips resolve when the reply fails', async () => {
    boundedRun.mockResolvedValueOnce(lookup).mockResolvedValueOnce(fail);
    expect(await dismissThread('PRRT_x', 'note')).toBe('failed');
    expect(boundedRun).toHaveBeenCalledTimes(2); // lookup + reply, no resolve
  });

  it('returns failed when the lookup yields no node', async () => {
    boundedRun.mockResolvedValueOnce(ok(JSON.stringify({ data: { node: null } })));
    expect(await dismissThread('PRRT_x', 'note')).toBe('failed');
    expect(boundedRun).toHaveBeenCalledTimes(1);
  });
});
