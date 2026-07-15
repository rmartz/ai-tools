import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as Tracking from '../src/tracking.js';

const reportToTracking = vi.fn();
vi.mock('../src/tracking.js', async () => {
  const actual = await vi.importActual<typeof Tracking>('../src/tracking.js');
  return { ...actual, reportToTracking };
});

const { reportAnomaly, ledgerTitle } = await import('../src/anomaly.js');
const { DEFAULT_TRACKING_REPO } = await import('../src/tracking.js');

beforeEach(() => {
  reportToTracking.mockReset();
  reportToTracking.mockResolvedValue('https://github.com/rmartz/ai-reports/issues/1');
});

const base = {
  category: 'fix-review-loop' as const,
  summary: 'fix-review did not converge',
  sourceRepo: 'rmartz/app',
  timestamp: '2026-06-23T12:00:00Z',
};

describe('ledgerTitle', () => {
  it('returns the stable schema title verbatim for a known category', () => {
    expect(ledgerTitle('duration-outlier')).toBe(
      'tracking: step duration outlier (duration-outlier)',
    );
    expect(ledgerTitle('ci-budget-exhausted')).toBe(
      'tracking: CI budget exhausted (ci-budget-exhausted)',
    );
  });

  it('appends a trimmed subject as a ": <subject>" suffix', () => {
    expect(ledgerTitle('fix-review-loop', '  /review  ')).toBe(
      'tracking: non-converging fix-review loop (fix-review-loop): /review',
    );
  });

  it('ignores an empty/whitespace subject', () => {
    expect(ledgerTitle('merge-failure', '   ')).toBe('tracking: merge failure (merge-failure)');
  });

  it('returns null for an unknown category', () => {
    expect(ledgerTitle('premature-exit' as never)).toBeNull();
  });
});

describe('reportAnomaly', () => {
  it('maps category+subject to the ledger title and files through reportToTracking', async () => {
    const url = await reportAnomaly({ ...base, subject: '/review' });

    expect(url).toBe('https://github.com/rmartz/ai-reports/issues/1');
    const [title, body, opts] = reportToTracking.mock.calls[0];
    expect(title).toBe('tracking: non-converging fix-review loop (fix-review-loop): /review');
    expect(opts.repo).toBe(DEFAULT_TRACKING_REPO);
    expect(opts.sourceRepo).toBe('rmartz/app');
    expect(body).toContain('fix-review did not converge');
  });

  it('renders detail, evidence, and correlation facts into the body', async () => {
    await reportAnomaly({
      ...base,
      detail: 'observed 5 retries',
      runId: 'run-9',
      stepInstanceId: 'step-3',
      headSha: 'cafef00d',
      skillVersion: 'v2',
      evidence: { retryCount: 5, badSha: 'deadbeef' },
    });

    const [, body] = reportToTracking.mock.calls[0];
    expect(body).toContain('observed 5 retries');
    expect(body).toContain('**Run:** run-9');
    expect(body).toContain('**Step instance:** step-3');
    expect(body).toContain('**Head SHA:** cafef00d');
    expect(body).toContain('**Skill version:** v2');
    expect(body).toContain('**retryCount:** 5');
    expect(body).toContain('**badSha:** deadbeef');
  });

  it('surfaces gitHash as the coordinator sha and forwards pr/transcript', async () => {
    await reportAnomaly({ ...base, pr: 42, gitHash: 'abc1234', transcriptId: 'tx-7' });

    const [, , opts] = reportToTracking.mock.calls[0];
    expect(opts.coordinatorSha).toBe('abc1234');
    expect(opts.pr).toBe(42);
    expect(opts.transcriptId).toBe('tx-7');
  });

  it('omits coordinatorSha when no gitHash is supplied (local-HEAD fallback)', async () => {
    await reportAnomaly(base);
    const [, , opts] = reportToTracking.mock.calls[0];
    expect(opts.coordinatorSha).toBeUndefined();
  });

  it('honors an overridden ledger repo', async () => {
    await reportAnomaly(base, { repo: 'rmartz/other-reports' });
    const [, , opts] = reportToTracking.mock.calls[0];
    expect(opts.repo).toBe('rmartz/other-reports');
  });

  it('soft-fails to null for an unknown category without filing', async () => {
    const url = await reportAnomaly({
      ...base,
      category: 'premature-exit' as never,
    });
    expect(url).toBeNull();
    expect(reportToTracking).not.toHaveBeenCalled();
  });

  it('propagates a soft-fail null from reportToTracking', async () => {
    reportToTracking.mockResolvedValue(null);
    expect(await reportAnomaly(base)).toBeNull();
  });
});
