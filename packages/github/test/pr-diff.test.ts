import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });
const json = (v: unknown) => ok(JSON.stringify(v));

const { computePrDiff } = await import('../src/pr-diff.js');

const linear = {
  total_commits: 2,
  commits: [
    { sha: 'a', parents: [{ sha: 'base' }] },
    { sha: 'b', parents: [{ sha: 'a' }] },
  ],
  files: [{ filename: 'src/x.ts', patch: '@@ -1 +1 @@\n-old\n+new' }],
};

describe('computePrDiff', () => {
  beforeEach(() => boundedRun.mockReset());

  it('emits a unified per-file diff when the range has no merge commit', async () => {
    boundedRun.mockResolvedValueOnce(json(linear));
    const out = await computePrDiff('base', 'b', 'r/r');
    expect(out).toContain('=== src/x.ts ===');
    expect(out).toContain('+new');
    expect(boundedRun).toHaveBeenCalledTimes(1); // single compare call
  });

  it('notes a no-patch file (binary/empty) with its status', async () => {
    boundedRun.mockResolvedValueOnce(
      json({
        total_commits: 1,
        commits: [{ sha: 'b', parents: [{ sha: 'base' }] }],
        files: [{ filename: 'img.png', status: 'added' }],
      }),
    );
    const out = await computePrDiff('base', 'b', 'r/r');
    expect(out).toContain('=== img.png ===');
    expect(out).toContain('(no patch — added)');
  });

  it('walks the first-parent chain, skipping a clean main merge', async () => {
    // compare range: base -> author commit `a` -> merge `m` (pulls main)
    boundedRun
      .mockResolvedValueOnce(
        json({
          total_commits: 2,
          commits: [
            { sha: 'a', commit: { message: 'feat: real change' }, parents: [{ sha: 'base' }] },
            { sha: 'm', parents: [{ sha: 'a' }, { sha: 'main2' }] },
          ],
          files: [{ filename: 'noise.ts', patch: 'main noise' }],
        }),
      )
      // per-commit: api for author commit `a`
      .mockResolvedValueOnce(json({ files: [{ filename: 'src/real.ts', patch: '+real' }] }))
      // merge note: compare p1...m and p2...m (clean — disjoint files)
      .mockResolvedValueOnce(json({ files: [{ filename: 'from-main.ts' }] }))
      .mockResolvedValueOnce(json({ files: [{ filename: 'src/real.ts' }] }));
    const out = await computePrDiff('base', 'm', 'r/r');
    expect(out).toContain('--- commit a: feat: real change ---');
    expect(out).toContain('+real');
    expect(out).toContain('clean merge from main');
    expect(out).not.toContain('main noise'); // unified-range noise excluded
  });

  it('surfaces files a merge changed relative to BOTH parents', async () => {
    boundedRun
      .mockResolvedValueOnce(
        json({
          total_commits: 1,
          commits: [{ sha: 'm', parents: [{ sha: 'base' }, { sha: 'main2' }] }],
          files: [],
        }),
      )
      // p1...m and p2...m both list shared.ts → edited during the merge
      .mockResolvedValueOnce(json({ files: [{ filename: 'shared.ts', patch: '+merged' }] }))
      .mockResolvedValueOnce(json({ files: [{ filename: 'shared.ts' }] }));
    const out = await computePrDiff('base', 'm', 'r/r');
    expect(out).toContain('changed by BOTH this branch and main');
    expect(out).toContain('(merge: branch + main)');
  });

  it('warns and falls back to unified on a truncated compare with merges', async () => {
    const warn = vi.fn();
    boundedRun.mockResolvedValueOnce(
      json({
        total_commits: 300,
        commits: [{ sha: 'm', parents: [{ sha: 'x' }, { sha: 'y' }] }],
        files: [{ filename: 'f.ts', patch: '+x' }],
      }),
    );
    const out = await computePrDiff('base', 'm', 'r/r', { warn });
    expect(warn).toHaveBeenCalledOnce();
    expect(out).toContain('=== f.ts ===');
  });

  it('throws when the compare API fails', async () => {
    boundedRun.mockResolvedValue({ stdout: '', stderr: 'nope', code: 1, timedOut: false });
    await expect(computePrDiff('base', 'b', 'r/r', { sleep: async () => {} })).rejects.toThrow();
  });
});
