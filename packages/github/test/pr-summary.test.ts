import { describe, it, expect, vi } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic
// (deny-by-default network/subprocess, the spirit of dotfiles' _hermetic.py).
vi.mock('@rmartz/agent-runtime', () => ({
  boundedRun: vi.fn(async () => ({
    stdout: JSON.stringify({
      number: 7,
      title: 'feat: thing',
      state: 'OPEN',
      isDraft: false,
      labels: [{ name: 'Auth' }, { name: 'approved' }],
      mergeable: 'MERGEABLE',
    }),
    stderr: '',
    code: 0,
    timedOut: false,
  })),
}));

const { fetchPrSummary } = await import('../src/pr-summary.js');

describe('fetchPrSummary', () => {
  it('flattens gh label objects to names', async () => {
    const summary = await fetchPrSummary('rmartz/ai-tools', 7);
    expect(summary.labels).toEqual(['Auth', 'approved']);
    expect(summary.mergeable).toBe('MERGEABLE');
  });
});
