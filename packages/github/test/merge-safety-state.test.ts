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
    expect(paths.slice(1)).toEqual([
      `repos/o/r/commits/${HEAD}/status?per_page=100`,
      `repos/o/r/commits/${HEAD}/check-runs?check_name=merge-safety&filter=all&per_page=100`,
    ]);
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
      checkRuns: { check_runs: [checkRun(3, 'completed', 'neutral', 'No update required')] },
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

  it('reports a merged PR as merged', async () => {
    routeGh({ pull: { ...openPull, state: 'closed', merged: true } });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.state).toBe('merged');
  });

  it('skips the verdict reads for a merged PR', async () => {
    const paths = routeGh({ pull: { ...openPull, state: 'closed', merged: true } });
    await readMergeSafetySnapshot('o/r', 7, noWait);
    expect(paths).toEqual(['repos/o/r/pulls/7']);
  });

  // A consumer's Actions job is often named `merge-safety` too; its title-less job
  // entries (including a transient-error `cancelled` one) are not verdicts.
  it('ignores title-less job entries that share the check name', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [] },
      checkRuns: {
        check_runs: [
          checkRun(5, 'in_progress', null, 'Update required'),
          checkRun(9, 'completed', 'success', ''),
        ],
      },
    });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report?.title).toBe(
      'Update required',
    );
  });

  it('reports no verdict when the only run is a cancelled job entry', async () => {
    routeGh({
      pull: openPull,
      status: { statuses: [] },
      checkRuns: {
        check_runs: [
          { id: 4, status: 'completed', conclusion: 'cancelled', output: { title: null } },
        ],
      },
    });
    expect((await readMergeSafetySnapshot('o/r', 7, noWait))?.report).toBeNull();
  });

  it('returns null when the status read fails', async () => {
    routeGh({ pull: openPull });
    expect(await readMergeSafetySnapshot('o/r', 7, noWait)).toBeNull();
  });
});
