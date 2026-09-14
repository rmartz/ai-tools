import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type * as GithubModule from '@rmartz/github';

vi.mock('@rmartz/github', async (importActual) => {
  const actual = await importActual<typeof GithubModule>();
  return { ...actual, listIssueComments: vi.fn() };
});

import { listIssueComments } from '@rmartz/github';
import {
  renderFindingsRecord,
  renderSynthesisRecord,
  renderFixConfirmationRecord,
  readLatestFindings,
  readLatestSynthesis,
  readLatestFixConfirmation,
  type ReviewFindingsRecord,
  type ReviewSynthesisRecord,
  type FixConfirmationRecord,
} from './review-records.js';

const findings: ReviewFindingsRecord = {
  skill: 'review',
  prHead: 'head-2',
  diffScope: 'incremental',
  findings: [
    {
      category: 'correctness',
      severity: 'blocking',
      location: { path: 'a.ts', line: 5 },
      summary: 'off-by-one',
    },
  ],
};

const synthesis: ReviewSynthesisRecord = {
  skill: 'synthesize-review',
  prHead: 'head-2',
  verdict: 'soft_reject',
  reviewBody: '## Verdict\nchanges requested -- see `x`',
  threadDispositions: [{ url: 'u', disposition: 'fix', replyText: 'addressed' }],
  actionList: {
    requiredChanges: [{ location: { path: 'a.ts' }, guidance: 'fix it' }],
    issuesToFile: [],
  },
  uat: { status: 'pending' },
};

const fixConfirmation: FixConfirmationRecord = {
  skill: 'fix-review',
  prHead: 'head-2',
  outcome: 'fixed',
  body: 'Fixed null guard in `json-marker.ts`.',
};

const asComments = (bodies: string[]) => bodies.map((body, i) => ({ id: i, author: 'x', body }));

beforeEach(() => {
  (listIssueComments as Mock).mockReset();
});

describe('review-records', () => {
  it('renders a findings record that reads back for the matching head', async () => {
    (listIssueComments as Mock).mockResolvedValue(asComments([renderFindingsRecord(findings)]));
    expect(await readLatestFindings('o/r', 7, 'head-2')).toEqual(findings);
  });

  it('renders a synthesis record (free-form body + nested action-list) that reads back', async () => {
    (listIssueComments as Mock).mockResolvedValue(asComments([renderSynthesisRecord(synthesis)]));
    const got = await readLatestSynthesis('o/r', 7, 'head-2');
    expect(got?.verdict).toBe('soft_reject');
    expect(got?.reviewBody).toBe(synthesis.reviewBody);
    expect(got?.actionList.requiredChanges[0]?.guidance).toBe('fix it');
  });

  it('renders a fix-confirmation record that reads back for the matching head', async () => {
    (listIssueComments as Mock).mockResolvedValue(
      asComments([renderFixConfirmationRecord(fixConfirmation)]),
    );
    expect(await readLatestFixConfirmation('o/r', 7, 'head-2')).toEqual(fixConfirmation);
  });

  it('ignores a record left by an earlier head', async () => {
    const stale = renderFindingsRecord({ ...findings, prHead: 'head-1' });
    (listIssueComments as Mock).mockResolvedValue(asComments([stale]));
    expect(await readLatestFindings('o/r', 7, 'head-2')).toBeNull();
  });

  it('ignores a fix-confirmation record left by an earlier head', async () => {
    const stale = renderFixConfirmationRecord({ ...fixConfirmation, prHead: 'head-1' });
    (listIssueComments as Mock).mockResolvedValue(asComments([stale]));
    expect(await readLatestFixConfirmation('o/r', 7, 'head-2')).toBeNull();
  });

  it('returns the latest of several same-head records', async () => {
    const first = renderFindingsRecord(findings);
    const second = renderFindingsRecord({ ...findings, diffScope: 'full' });
    (listIssueComments as Mock).mockResolvedValue(asComments([first, second]));
    expect((await readLatestFindings('o/r', 7, 'head-2'))?.diffScope).toBe('full');
  });

  it('returns the latest fix-confirmation of several same-head records', async () => {
    const first = renderFixConfirmationRecord(fixConfirmation);
    const second = renderFixConfirmationRecord({ ...fixConfirmation, outcome: 'skipped' });
    (listIssueComments as Mock).mockResolvedValue(asComments([first, second]));
    expect((await readLatestFixConfirmation('o/r', 7, 'head-2'))?.outcome).toBe('skipped');
  });
});
