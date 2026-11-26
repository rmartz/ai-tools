import { describe, it, expect, vi, beforeEach } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic.
const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const { bodyRebaseMarker, isDependabotRequest, parseDependabotCommand, readDependabotSnapshot } =
  await import('../src/dependabot-state.js');

const noWait = { sleep: async () => {} };

const ok = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: '',
  code: 0,
  timedOut: false,
});
const fail = { stdout: '', stderr: 'boom', code: 1, timedOut: false };

interface Routes {
  pull?: unknown;
  comments?: unknown;
  commits?: unknown;
  reactions?: unknown;
}

/** Route each `gh api <path>` call to a canned response by its endpoint. */
function routeGh(routes: Routes): void {
  boundedRun.mockImplementation(async (_cmd: string, argv: string[]) => {
    const path = argv.find((a) => a.startsWith('repos/')) ?? '';
    const value = path.endsWith('/reactions')
      ? routes.reactions
      : path.endsWith('/comments')
        ? routes.comments
        : path.endsWith('/commits')
          ? routes.commits
          : routes.pull;
    return value === undefined ? fail : ok(value);
  });
}

const openPull = { state: 'open', merged: false, body: 'Bumps foo from 1.0.0 to 1.1.0.' };
const comment = (id: number, login: string, body: string, created_at: string) => ({
  id,
  user: { login },
  body,
  created_at,
});

beforeEach(() => {
  boundedRun.mockReset();
});

describe('bodyRebaseMarker', () => {
  it('detects an in-progress rebase', () => {
    expect(bodyRebaseMarker('> **Dependabot is rebasing this PR**')).toBe('in_progress');
  });

  it('detects a failed rebase', () => {
    expect(bodyRebaseMarker('Dependabot rebase failed: conflicts')).toBe('failed');
  });

  it('returns none for a plain body', () => {
    expect(bodyRebaseMarker('Bumps foo.')).toBe('none');
  });
});

describe('parseDependabotCommand', () => {
  it('reads a rebase command', () => {
    expect(parseDependabotCommand('@dependabot rebase')).toBe('rebase');
  });

  it('reads a recreate command after leading whitespace', () => {
    expect(parseDependabotCommand('\n@dependabot recreate')).toBe('recreate');
  });

  it('ignores a command mentioned mid-comment', () => {
    expect(parseDependabotCommand('I posted @dependabot rebase earlier')).toBeNull();
  });

  it('ignores other Dependabot commands', () => {
    expect(parseDependabotCommand('@dependabot merge')).toBeNull();
  });
});

describe('isDependabotRequest', () => {
  it('matches rebase and recreate commands', () => {
    expect(['@dependabot rebase', '  @dependabot recreate'].map(isDependabotRequest)).toEqual([
      true,
      true,
    ]);
  });

  it('ignores other comments', () => {
    expect(isDependabotRequest('please @dependabot rebase')).toBe(false);
  });
});

describe('readDependabotSnapshot', () => {
  it('marks the latest request acknowledged when dependabot[bot] reacted', async () => {
    routeGh({
      pull: openPull,
      comments: [
        comment(1, 'rmartz', '@dependabot rebase', '2026-11-11T19:11:22Z'),
        comment(2, 'rmartz', '@dependabot rebase', '2026-11-11T19:17:00Z'),
      ],
      commits: [],
      reactions: [
        { user: { login: 'dependabot[bot]' }, content: '+1', created_at: '2026-11-11T19:17:05Z' },
      ],
    });
    const snapshot = await readDependabotSnapshot('o/r', 42, noWait);
    expect(snapshot?.request).toEqual({
      commentId: 2,
      createdAt: '2026-11-11T19:17:00Z',
      acknowledged: true,
    });
  });

  it('leaves the request unacknowledged when only humans reacted', async () => {
    routeGh({
      pull: openPull,
      comments: [comment(2, 'rmartz', '@dependabot rebase', '2026-11-11T19:17:00Z')],
      commits: [],
      reactions: [{ user: { login: 'rmartz' }, content: '+1' }],
    });
    const snapshot = await readDependabotSnapshot('o/r', 42, noWait);
    expect(snapshot?.request?.acknowledged).toBe(false);
  });

  it('takes the latest dependabot[bot] commit time', async () => {
    routeGh({
      pull: openPull,
      comments: [],
      commits: [
        {
          author: { login: 'dependabot[bot]' },
          commit: { committer: { date: '2026-11-11T19:12:04Z' } },
        },
        { author: { login: 'rmartz' }, commit: { committer: { date: '2026-11-11T20:00:00Z' } } },
      ],
    });
    const snapshot = await readDependabotSnapshot('o/r', 42, noWait);
    expect(snapshot?.lastBotCommitAt).toBe('2026-11-11T19:12:04Z');
  });

  it('reports a merged PR without reading comments', async () => {
    routeGh({ pull: { state: 'closed', merged: true, body: '' } });
    const snapshot = await readDependabotSnapshot('o/r', 42, noWait);
    expect(snapshot?.state).toBe('merged');
  });

  it('returns null when a read fails', async () => {
    routeGh({ pull: openPull, commits: [] });
    expect(await readDependabotSnapshot('o/r', 42, noWait)).toBeNull();
  });
});
