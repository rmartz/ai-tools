import { describe, it, expect, vi, beforeEach } from 'vitest';

const findOpenIssue = vi.fn();
const createIssue = vi.fn();
const addIssueComment = vi.fn();
const resolveRepoTarget = vi.fn();
vi.mock('@rmartz/github', () => ({
  findOpenIssue,
  createIssue,
  addIssueComment,
  resolveRepoTarget,
}));

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const {
  formatOccurrence,
  reportToTracking,
  coordinatorGitSha,
  resetCoordinatorShaCache,
  resolveTrackingRepo,
  requireTrackingRepo,
  MISSING_TRACKING_REPO,
} = await import('../src/tracking.js');

beforeEach(() => {
  findOpenIssue.mockReset();
  createIssue.mockReset();
  addIssueComment.mockReset();
  resolveRepoTarget.mockReset();
  boundedRun.mockReset();
  resetCoordinatorShaCache();
});

describe('formatOccurrence', () => {
  it('renders only the provided fields, in order', () => {
    const out = formatOccurrence('the body', {
      sourceRepo: 'rmartz/app',
      coordinatorSha: 'abc123',
      skill: '/review',
      pr: 42,
      transcriptId: 'tx-1',
      skillMeta: 'm',
    });
    expect(out).toBe(
      '**Repository:** `rmartz/app`\n' +
        '**Coordinator:** `abc123`\n' +
        '**Skill:** `/review`\n' +
        '**PR:** rmartz/app#42\n' +
        '**Transcript:** `tx-1`\n' +
        '**Skill metadata:** `m`\n\n' +
        'the body',
    );
  });

  it('renders a bare PR ref when no source repo is known', () => {
    expect(formatOccurrence('b', { pr: 7 })).toBe('**PR:** #7\n\nb');
  });

  it('returns the body unchanged when no metadata is available', () => {
    expect(formatOccurrence('just text')).toBe('just text');
  });

  it('omits an empty PR value', () => {
    expect(formatOccurrence('b', { pr: '' })).toBe('b');
  });
});

describe('coordinatorGitSha', () => {
  it('returns the trimmed short sha and caches it', async () => {
    boundedRun.mockResolvedValueOnce({ stdout: 'deadbee\n', stderr: '', code: 0, timedOut: false });
    expect(await coordinatorGitSha()).toBe('deadbee');
    expect(await coordinatorGitSha()).toBe('deadbee');
    expect(boundedRun).toHaveBeenCalledTimes(1);
  });

  it('soft-fails to null when git fails', async () => {
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: 'x', code: 1, timedOut: false });
    expect(await coordinatorGitSha()).toBeNull();
  });
});

describe('resolveTrackingRepo', () => {
  it('prefers the explicit repo over the env var', () => {
    expect(resolveTrackingRepo('flag/repo', { AI_TRACKING_REPO: 'env/repo' })).toBe('flag/repo');
  });

  it('falls back to AI_TRACKING_REPO', () => {
    expect(resolveTrackingRepo(undefined, { AI_TRACKING_REPO: 'env/repo' })).toBe('env/repo');
  });

  it('treats a blank env var as unset', () => {
    expect(resolveTrackingRepo(undefined, { AI_TRACKING_REPO: '  ' })).toBeUndefined();
  });
});

describe('requireTrackingRepo', () => {
  it('returns the configured repo', () => {
    expect(requireTrackingRepo(undefined, { AI_TRACKING_REPO: 'env/repo' })).toBe('env/repo');
  });

  it('throws a message naming the flag and env var when neither is set', () => {
    expect(() => requireTrackingRepo(undefined, {})).toThrow(
      'no tracking ledger repo configured: pass --repo owner/repo or set AI_TRACKING_REPO',
    );
  });
});

describe('reportToTracking', () => {
  it('throws the missing-repo error when no ledger repo is configured', async () => {
    vi.stubEnv('AI_TRACKING_REPO', '');
    try {
      await expect(reportToTracking('tracking: Z', 'body')).rejects.toThrow(MISSING_TRACKING_REPO);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('appends a comment when an open ledger exists (find-or-append)', async () => {
    resolveRepoTarget.mockResolvedValue('rmartz/app');
    boundedRun.mockResolvedValue({ stdout: 'sha1\n', stderr: '', code: 0, timedOut: false });
    findOpenIssue.mockResolvedValue('https://github.com/octo/reports/issues/9');
    addIssueComment.mockResolvedValue('cmt-url');

    const url = await reportToTracking('tracking: X (anomaly)', 'occurrence', {
      repo: 'octo/reports',
      skill: '/merge',
    });

    expect(url).toBe('https://github.com/octo/reports/issues/9');
    expect(createIssue).not.toHaveBeenCalled();
    const [repo, query] = findOpenIssue.mock.calls[0];
    expect(repo).toBe('octo/reports');
    expect(query).toEqual({ titleEquals: 'tracking: X (anomaly)', label: 'tracking' });
    const [, , body] = addIssueComment.mock.calls[0];
    expect(body).toContain('**Repository:** `rmartz/app`');
    expect(body).toContain('**Coordinator:** `sha1`');
    expect(body).toContain('**Skill:** `/merge`');
    expect(body).toContain('occurrence');
  });

  it('creates the ledger with the tracking label on first occurrence', async () => {
    resolveRepoTarget.mockResolvedValue('rmartz/app');
    boundedRun.mockResolvedValue({ stdout: 'sha1\n', stderr: '', code: 0, timedOut: false });
    findOpenIssue.mockResolvedValue(null);
    createIssue.mockResolvedValue('https://github.com/octo/reports/issues/10');

    const url = await reportToTracking('tracking: Y', 'first', {
      repo: 'octo/reports',
      extraLabels: ['DevOps'],
    });

    expect(url).toBe('https://github.com/octo/reports/issues/10');
    expect(addIssueComment).not.toHaveBeenCalled();
    const [repo, opts] = createIssue.mock.calls[0];
    expect(repo).toBe('octo/reports');
    expect(opts.labels).toEqual(['tracking', 'DevOps']);
    expect(opts.title).toBe('tracking: Y');
  });

  it('honors an overridden ledger repo and label', async () => {
    resolveRepoTarget.mockResolvedValue(null);
    boundedRun.mockResolvedValue({ stdout: '', stderr: '', code: 1, timedOut: false });
    findOpenIssue.mockResolvedValue(null);
    createIssue.mockResolvedValue('u');

    await reportToTracking('t', 'b', { repo: 'rmartz/other', label: 'coordinator-self-report' });

    const [repo, query] = findOpenIssue.mock.calls[0];
    expect(repo).toBe('rmartz/other');
    expect(query.label).toBe('coordinator-self-report');
    const [, opts] = createIssue.mock.calls[0];
    expect(opts.labels).toEqual(['coordinator-self-report']);
  });

  it('forwards cwd to resolveRepoTarget when sourceRepo is omitted', async () => {
    resolveRepoTarget.mockResolvedValue('rmartz/from-cwd');
    boundedRun.mockResolvedValue({ stdout: '', stderr: '', code: 1, timedOut: false });
    findOpenIssue.mockResolvedValue(null);
    createIssue.mockResolvedValue('u');

    await reportToTracking('t', 'b', { repo: 'octo/reports', cwd: '/other/checkout' });

    expect(resolveRepoTarget).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/other/checkout' }),
    );
  });

  it('does not resolve the repo when sourceRepo is supplied', async () => {
    boundedRun.mockResolvedValue({ stdout: 'sha\n', stderr: '', code: 0, timedOut: false });
    findOpenIssue.mockResolvedValue(null);
    createIssue.mockResolvedValue('u');

    await reportToTracking('t', 'b', { repo: 'octo/reports', sourceRepo: 'rmartz/given' });

    expect(resolveRepoTarget).not.toHaveBeenCalled();
    const [, opts] = createIssue.mock.calls[0];
    expect(opts.body).toContain('**Repository:** `rmartz/given`');
  });
});
