import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const { readMergeSafetySnapshot } = await import('../src/merge-safety-state.js');

const noWait = { sleep: async () => {} };
const HEAD = 'newhead0000';

const ok = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: '',
  code: 0,
  timedOut: false,
});
const fail = { stdout: '', stderr: 'boom', code: 1, timedOut: false };

interface Routes {
  pull?: unknown;
  status?: unknown;
  checkRuns?: unknown;
}

/** Route each `gh api <path>` call to a canned response; record the paths read. */
function routeGh(routes: Routes): string[] {
  const paths: string[] = [];
  boundedRun.mockImplementation(async (_cmd: string, argv: string[]) => {
    const path = argv.find((a) => a.startsWith('repos/')) ?? '';
    paths.push(path);
    const value = path.includes('/status?')
      ? routes.status
      : path.includes('/check-runs?')
        ? routes.checkRuns
        : routes.pull;
    return value === undefined ? fail : ok(value);
  });
  return paths;
}

const openPull = { state: 'open', merged: false, body: '', head: { sha: HEAD } };
const status = (state: string, description: string, context = 'merge-safety') => ({
  context,
  state,
  description,
});
const checkRun = (id: number, status: string, conclusion: string | null, title: string) => ({
  id,
  status,
  conclusion,
  output: { title },
});

beforeEach(() => {
  boundedRun.mockReset();
});

describe('readMergeSafetySnapshot', () => {
  it('reads the verdict from the current head commit only', async () => {
    const paths = routeGh({
      pull: openPull,
      status: { statuses: [] },
      checkRuns: { check_runs: [] },
    });
    await readMergeSafetySnapshot('o/r', 7, noWait);
    // After a rebase, the old head's `Update required` must never count for the new one.
    expect(paths.slice(1).every((p) => p.includes(`/commits/${HEAD}/`))).toBe(true);
  });

  it('prefers the commit status, which is what the merge gate relies on', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [status('pending', 'Update required')] },
      checkRuns: { check_runs: [checkRun(1, 'completed', 'success', 'No update required')] },
    });
    const snapshot = await readMergeSafetySnapshot('o/r', 7, noWait);
    expect(snapshot?.report).toEqual({
      source: 'status',
      state: 'pending',
      title: 'Update required',
    });
  });

  it('ignores commit statuses from other contexts', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [status('success', 'ok', 'ci')] },
      checkRuns: { check_runs: [] },
    });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report).toBeNull();
  });

  it('maps a commit status error to a failure', async () => {
    routeGh({ pull: openPull, status: { statuses: [status('error', 'Could not evaluate')] } });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report?.state).toBe('failure');
  });

  it('falls back to the newest check-run when no status is posted', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [] },
      checkRuns: {
        check_runs: [
          checkRun(5, 'completed', 'success', 'No update required'),
          checkRun(9, 'in_progress', null, 'Update required'),
        ],
      },
    });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report).toEqual({
      source: 'check-run',
      state: 'pending',
      title: 'Update required',
    });
  });

  it('treats a stale check-run as still pending', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [] },
      checkRuns: { check_runs: [checkRun(3, 'completed', 'stale', 'Update required')] },
    });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report?.state).toBe('pending');
  });

  it('treats a neutral check-run as a success', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [] },
      checkRuns: { check_runs: [checkRun(3, 'completed', 'neutral', '')] },
    });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report?.state).toBe('success');
  });

  it('reports no verdict when neither a status nor a check-run is posted', async () => {
    routeGh({ pull: openPull, status: { statuses: [] }, checkRuns: { check_runs: [] } });
    expect(await readMergeSafetySnapshot('o/r', 7, noWait)).toEqual({
      state: 'open',
      headSha: HEAD,
      report: null,
    });
  });

  it('skips the verdict reads for a merged PR', async () => {
    const paths = routeGh({ pull: { ...openPull, state: 'closed', merged: true } });
    const snapshot = await readMergeSafetySnapshot('o/r', 7, noWait);
    expect([snapshot?.state, paths.length]).toEqual(['merged', 1]);
  });

  it('returns null when the status read fails', async () => {
    routeGh({ pull: openPull });
    expect(await readMergeSafetySnapshot('o/r', 7, noWait)).toBeNull();
  });
});
