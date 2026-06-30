import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });
const json = (v: unknown) => ok(JSON.stringify(v));

const { gatherRepoStatus } = await import('../src/repo-status.js');

// Call order: currentRepo, then Promise.all(issues, milestones, prs).
function arrange(opts: { issues: unknown; milestones: unknown; prs: unknown }) {
  boundedRun
    .mockResolvedValueOnce(ok('rmartz/ai-tools\n')) // currentRepo
    .mockResolvedValueOnce(json(opts.issues))
    .mockResolvedValueOnce(json(opts.milestones))
    .mockResolvedValueOnce(json(opts.prs));
}

describe('gatherRepoStatus', () => {
  beforeEach(() => boundedRun.mockReset());

  it('filters blocked/manual issues and parses deps from the body', async () => {
    arrange({
      issues: [
        {
          number: 1,
          title: 'A',
          body: 'depends on #4 and requires #5',
          labels: [],
          milestone: { title: 'M' },
          assignees: [{ login: 'me' }],
        },
        { number: 2, title: 'B', body: '', labels: [{ name: 'blocked' }] },
        { number: 3, title: 'C', body: '', labels: [{ name: 'manual' }] },
      ],
      milestones: [{ title: 'M', number: 7, open_issues: 3 }],
      prs: [],
    });
    const status = await gatherRepoStatus();
    expect(status.issues).toHaveLength(1);
    expect(status.issues[0]).toMatchObject({
      number: 1,
      milestone: 'M',
      deps: [4, 5],
      assignees: ['me'],
    });
    expect(status.milestones[0]).toEqual({ title: 'M', number: 7, openIssues: 3 });
  });

  it('resolves PR issue numbers from same-repo closing references', async () => {
    arrange({
      issues: [],
      milestones: [],
      prs: [
        {
          number: 10,
          headRefName: 'feat/issue-99-thing',
          closingIssuesReferences: [
            { number: 42, repository: { nameWithOwner: 'rmartz/ai-tools' } },
            { number: 7, repository: { nameWithOwner: 'other/repo' } },
          ],
        },
      ],
    });
    const status = await gatherRepoStatus();
    // Same-repo closing ref wins; cross-repo dropped; branch fallback suppressed.
    expect(status.openPrs[0].issueNumbers).toEqual([42]);
    expect(status.openPrNumbers).toEqual([10]);
  });

  it('falls back to the branch convention, then the body', async () => {
    arrange({
      issues: [],
      milestones: [],
      prs: [
        { number: 11, headRefName: 'feat/issue-55-x', closingIssuesReferences: [] },
        {
          number: 12,
          headRefName: 'random-branch',
          body: 'Fixes #88',
          closingIssuesReferences: [],
        },
      ],
    });
    const status = await gatherRepoStatus();
    expect(status.openPrs[0].issueNumbers).toEqual([55]);
    expect(status.openPrs[1].issueNumbers).toEqual([88]);
  });

  it('parses the branch convention with an optional type prefix', async () => {
    arrange({
      issues: [],
      milestones: [],
      prs: [
        // Unprefixed (the new default), a non-feat type, legacy feat/, and a
        // non-CC-type prefix that must NOT match.
        { number: 21, headRefName: 'issue-55-x', closingIssuesReferences: [] },
        { number: 22, headRefName: 'fix/issue-56-x', closingIssuesReferences: [] },
        { number: 23, headRefName: 'feat/issue-57-x', closingIssuesReferences: [] },
        { number: 24, headRefName: 'feature/issue-99-x', closingIssuesReferences: [] },
      ],
    });
    const status = await gatherRepoStatus();
    expect(status.openPrs[0].issueNumbers).toEqual([55]);
    expect(status.openPrs[1].issueNumbers).toEqual([56]);
    expect(status.openPrs[2].issueNumbers).toEqual([57]);
    expect(status.openPrs[3].issueNumbers).toEqual([]); // `feature/` is not a CC type
  });
});
