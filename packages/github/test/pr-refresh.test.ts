import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const { refreshPr } = await import('../src/pr-refresh.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const noWait = { sleep: async () => {}, now: () => NOW };

const ok = (stdout: unknown) => ({
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr: '',
  code: 0,
  timedOut: false,
});
const fail = { stdout: '', stderr: 'boom', code: 1, timedOut: false };

const makePull = (over: Record<string, unknown> = {}) => ({
  state: 'open',
  merged: false,
  user: { login: 'dependabot[bot]' },
  body: 'Bumps foo.',
  head: { sha: 'abc123' },
  base: { ref: 'main' },
  mergeable: true,
  ...over,
});

/** Route each `gh api <path>` call to a canned response; anything unrouted fails. */
function routeGh(routes: Record<string, unknown>): void {
  boundedRun.mockImplementation(async (_cmd: string, args: string[]) => {
    const path = args.find((a) => a.startsWith('repos/')) ?? '';
    const key = Object.keys(routes).find((k) => path.includes(k));
    if (key === undefined) return fail;
    const value = routes[key];
    return value === fail ? fail : ok(value);
  });
}

function postedBodies(): string[] {
  return boundedRun.mock.calls
    .filter(([, args]) => (args as string[]).includes('POST'))
    .map(([, , opts]) => (JSON.parse((opts as { input: string }).input) as { body: string }).body);
}

beforeEach(() => {
  boundedRun.mockReset();
});

describe('refreshPr: freshness gate', () => {
  it('reports already-current without posting', async () => {
    routeGh({ 'pulls/7': makePull(), compare: '0' });
    expect((await refreshPr('o/r', 7, noWait)).outcome).toBe('already-current');
  });

  it('reports a closed PR as closed', async () => {
    routeGh({ 'pulls/7': makePull({ state: 'closed' }) });
    expect((await refreshPr('o/r', 7, noWait)).outcome).toBe('closed');
  });

  it('fails when the PR cannot be read', async () => {
    routeGh({});
    expect((await refreshPr('o/r', 7, noWait)).outcome).toBe('failed');
  });
});

describe('refreshPr: Dependabot strategy', () => {
  it('posts @dependabot rebase on a behind branch with no request', async () => {
    routeGh({
      'pulls/7/commits': [],
      'issues/7/comments': [],
      'pulls/7': makePull(),
      compare: '3',
    });
    await refreshPr('o/r', 7, noWait);
    expect(postedBodies()).toEqual(['@dependabot rebase']);
  });

  it('reports pending without posting when a request is fresh', async () => {
    routeGh({
      'pulls/7/commits': [],
      'comments/11/reactions': [],
      'issues/7/comments': [
        {
          id: 11,
          user: { login: 'rmartz' },
          body: '@dependabot rebase',
          created_at: '2026-10-26T11:58:00Z',
        },
      ],
      'pulls/7': makePull(),
      compare: '3',
    });
    expect((await refreshPr('o/r', 7, noWait)).outcome).toBe('pending');
  });

  it('acts on a current branch when forced', async () => {
    routeGh({
      'pulls/7/commits': [],
      'issues/7/comments': [],
      'pulls/7': makePull(),
    });
    expect((await refreshPr('o/r', 7, { ...noWait, force: true })).outcome).toBe(
      'requested-rebase',
    );
  });
});

describe('refreshPr: update-branch strategy', () => {
  it('updates a behind non-Dependabot PR pinned to its head SHA', async () => {
    routeGh({
      'update-branch': { message: 'Updating pull request branch.' },
      'pulls/7': makePull({ user: { login: 'rmartz' } }),
      compare: '2',
    });
    await refreshPr('o/r', 7, noWait);
    const call = boundedRun.mock.calls.find(([, args]) =>
      (args as string[]).some((a) => a.endsWith('update-branch')),
    );
    expect(JSON.parse((call?.[2] as { input: string }).input)).toEqual({
      expected_head_sha: 'abc123',
    });
  });

  it('escalates a conflicting non-Dependabot PR instead of calling update-branch', async () => {
    routeGh({ 'pulls/7': makePull({ user: { login: 'rmartz' }, mergeable: false }), compare: '2' });
    expect((await refreshPr('o/r', 7, noWait)).outcome).toBe('escalate');
  });
});
