import { describe, it, expect } from 'vitest';
import {
  bodyRebaseMarker,
  decideDependabotRefresh,
  isRebaseRefusal,
  parseDependabotCommand,
  type DependabotRequest,
  type DependabotTimeline,
} from '../src/dependabot-refresh.js';

const NOW = new Date('2026-10-26T12:00:00Z');

/** An ISO timestamp `minutes` before NOW. */
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const makeRequest = (over: Partial<DependabotRequest> = {}): DependabotRequest => ({
  command: 'rebase',
  at: ago(2),
  acknowledgedAt: null,
  ...over,
});

const makeTimeline = (over: Partial<DependabotTimeline> = {}): DependabotTimeline => ({
  body: 'Bumps foo from 1.0.0 to 1.1.0.',
  requests: [],
  replies: [],
  lastPushAt: ago(600),
  ...over,
});

const POLICY = { pendingMinutes: 10, acknowledgedPendingMinutes: 30, maxAttempts: 3 };

const decide = (over: Partial<DependabotTimeline>) =>
  decideDependabotRefresh(makeTimeline(over), NOW, POLICY);

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

describe('isRebaseRefusal', () => {
  it('matches the edited-by-someone-else refusal', () => {
    expect(
      isRebaseRefusal(
        "This PR has been edited by someone other than Dependabot. That means Dependabot can't rebase it.",
      ),
    ).toBe(true);
  });

  it('matches the false already-up-to-date refusal', () => {
    expect(isRebaseRefusal('Looks like this PR is already up-to-date with main!')).toBe(true);
  });

  it('does not match an unrelated reply', () => {
    expect(isRebaseRefusal('Sorry, only users with push access can use that command.')).toBe(false);
  });
});

describe('bodyRebaseMarker', () => {
  it('detects a rebase in progress', () => {
    expect(bodyRebaseMarker('> **Dependabot is rebasing this PR**')).toBe('in-progress');
  });

  it('detects a failed rebase', () => {
    expect(bodyRebaseMarker('Dependabot rebase failed. See logs.')).toBe('failed');
  });

  it('returns null for a plain body', () => {
    expect(bodyRebaseMarker('Bumps foo.')).toBeNull();
  });
});

describe('decideDependabotRefresh: no request this cycle', () => {
  it('posts rebase when there has never been a request', () => {
    expect(decide({})).toMatchObject({ action: 'post', command: 'rebase' });
  });

  it('posts rebase when the only request predates the last push', () => {
    const requests = [makeRequest({ command: 'recreate', at: ago(700) })];
    expect(decide({ requests })).toMatchObject({ action: 'post', command: 'rebase' });
  });

  it('posts rebase over a failed marker left from an earlier cycle', () => {
    expect(decide({ body: 'Dependabot rebase failed' })).toMatchObject({
      action: 'post',
      command: 'rebase',
    });
  });
});

describe('decideDependabotRefresh: pending', () => {
  it('waits while the body says Dependabot is rebasing', () => {
    const requests = [makeRequest({ at: ago(45) })];
    expect(decide({ requests, body: 'Dependabot is rebasing this PR' }).action).toBe('wait');
  });

  it('waits on a fresh unacknowledged request', () => {
    expect(decide({ requests: [makeRequest({ at: ago(5) })] }).action).toBe('wait');
  });

  it('waits on an acknowledged request inside the longer window', () => {
    const requests = [makeRequest({ at: ago(25), acknowledgedAt: ago(20) })];
    expect(decide({ requests }).action).toBe('wait');
  });
});

describe('decideDependabotRefresh: rejection', () => {
  it('escalates a refused rebase to recreate', () => {
    const requests = [makeRequest({ at: ago(5) })];
    const replies = [{ at: ago(4), body: 'Looks like this PR is already up-to-date with main!' }];
    expect(decide({ requests, replies })).toMatchObject({ action: 'post', command: 'recreate' });
  });

  it('escalates to a human when a recreate is refused', () => {
    const requests = [
      makeRequest({ at: ago(9) }),
      makeRequest({ command: 'recreate', at: ago(5) }),
    ];
    const replies = [
      { at: ago(8), body: "edited by someone other than Dependabot. That means Dependabot can't" },
      { at: ago(4), body: "edited by someone other than Dependabot. That means Dependabot can't" },
    ];
    expect(decide({ requests, replies }).action).toBe('escalate');
  });

  it('steps up to recreate when the body reports a failed rebase', () => {
    const requests = [makeRequest({ at: ago(5) })];
    expect(decide({ requests, body: 'Dependabot rebase failed' })).toMatchObject({
      action: 'post',
      command: 'recreate',
    });
  });

  it('escalates on a Dependabot reply it does not recognise', () => {
    const requests = [makeRequest({ at: ago(5) })];
    const replies = [
      { at: ago(4), body: 'Sorry, only users with push access can use that command.' },
    ];
    expect(decide({ requests, replies }).action).toBe('escalate');
  });

  it('ignores a reply that predates the latest request', () => {
    const requests = [makeRequest({ at: ago(5) })];
    const replies = [{ at: ago(6), body: 'Looks like this PR is already up-to-date with main!' }];
    expect(decide({ requests, replies }).action).toBe('wait');
  });
});

describe('decideDependabotRefresh: no response', () => {
  it('re-posts an unacknowledged rebase after the pending window', () => {
    expect(decide({ requests: [makeRequest({ at: ago(15) })] })).toMatchObject({
      action: 'post',
      command: 'rebase',
    });
  });

  it('re-posts the same recreate command, not a rebase', () => {
    const requests = [
      makeRequest({ at: ago(60) }),
      makeRequest({ command: 'recreate', at: ago(15) }),
    ];
    const replies = [{ at: ago(59), body: 'already up-to-date with main' }];
    expect(decide({ requests, replies })).toMatchObject({ action: 'post', command: 'recreate' });
  });

  it('re-posts an acknowledged request once the longer window passes', () => {
    const requests = [makeRequest({ at: ago(40), acknowledgedAt: ago(35) })];
    expect(decide({ requests }).action).toBe('post');
  });

  it('escalates once the retry cap is reached', () => {
    const requests = [ago(50), ago(35), ago(20)].map((at) => makeRequest({ at }));
    expect(decide({ requests }).action).toBe('escalate');
  });
});
