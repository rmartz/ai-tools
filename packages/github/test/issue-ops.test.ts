import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });

const { findOpenIssue, createIssue, addIssueComment, addAssignees } =
  await import('../src/issue-ops.js');

describe('findOpenIssue', () => {
  beforeEach(() => boundedRun.mockReset());

  it('matches an exact title client-side and ignores near matches', async () => {
    boundedRun.mockResolvedValueOnce(
      ok(
        JSON.stringify([
          { title: 'Flaky tests in CI', url: 'u-near' },
          { title: 'Flaky tests', url: 'u-exact' },
        ]),
      ),
    );
    const url = await findOpenIssue('rmartz/ai-reports', { titleEquals: 'Flaky tests' });
    expect(url).toBe('u-exact');
  });

  it('matches by title prefix', async () => {
    boundedRun.mockResolvedValueOnce(
      ok(JSON.stringify([{ title: 'Tracking: X (anomaly)', url: 'u' }])),
    );
    const url = await findOpenIssue('r/r', { titlePrefix: 'Tracking:' });
    expect(url).toBe('u');
  });

  it('returns null when nothing matches', async () => {
    boundedRun.mockResolvedValueOnce(ok(JSON.stringify([{ title: 'Other', url: 'u' }])));
    const url = await findOpenIssue('r/r', { titleContains: 'absent' });
    expect(url).toBeNull();
  });

  it('soft-fails to null on total API failure', async () => {
    boundedRun.mockResolvedValue({ stdout: '', stderr: 'down', code: 1, timedOut: false });
    const url = await findOpenIssue('r/r', { titleEquals: 'x' }, { sleep: async () => {} });
    expect(url).toBeNull();
  });
});

describe('createIssue', () => {
  beforeEach(() => boundedRun.mockReset());

  it('returns the trimmed new-issue URL', async () => {
    boundedRun.mockResolvedValueOnce(ok('https://github.com/r/r/issues/12\n'));
    const url = await createIssue('r/r', { title: 'T', body: 'B', labels: ['tracking'] });
    expect(url).toBe('https://github.com/r/r/issues/12');
    const [, args] = boundedRun.mock.calls[0];
    expect(args).toContain('--input');
  });
});

describe('addIssueComment', () => {
  beforeEach(() => boundedRun.mockReset());

  it('returns the comment URL for a numeric reference', async () => {
    boundedRun.mockResolvedValueOnce(ok('https://github.com/r/r/issues/3#c1'));
    const url = await addIssueComment('r/r', 3, 'hello');
    expect(url).toBe('https://github.com/r/r/issues/3#c1');
  });

  it('returns null without calling gh for an unparseable reference', async () => {
    const url = await addIssueComment('r/r', 'garbage', 'hi');
    expect(url).toBeNull();
    expect(boundedRun).not.toHaveBeenCalled();
  });
});

describe('addAssignees', () => {
  beforeEach(() => boundedRun.mockReset());

  it('returns null without calling gh for an empty assignee list', async () => {
    const out = await addAssignees('r/r', 3, []);
    expect(out).toBeNull();
    expect(boundedRun).not.toHaveBeenCalled();
  });
});
