import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';

// `claude` is a real-world boundary — mock bounded-subprocess so even the
// default runner cannot spawn (deny-by-default; the spirit of _hermetic.py).
const boundedRun = vi.fn();
vi.mock('../src/bounded-subprocess.js', () => ({ boundedRun }));

const run = (over: Partial<{ stdout: string; stderr: string; code: number | null }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const {
  injectSessionId,
  claudeTranscriptPath,
  dispatchEnv,
  TranscriptResumeRegistry,
  dispatchSkill,
  defaultSkillRunner,
  ENV_PREVIOUS_TRANSCRIPT_ID,
  ENV_PREVIOUS_TRANSCRIPT_PATH,
  ENV_AGENT_TRANSCRIPT_ID,
  ENV_COORDINATOR_STARTED_AT,
} = await import('../src/skill-dispatch.js');

import type { ResumeEntry, ResumeStore } from '../src/resume.js';

/** Tiny in-memory ResumeStore so the durable path needs no fs/network. */
function memStore(initial: ResumeEntry[] = []): ResumeStore & { entries: ResumeEntry[] } {
  const entries = [...initial];
  return {
    entries,
    read: async () => entries,
    append: async (e) => {
      entries.push(e);
    },
  };
}

describe('injectSessionId', () => {
  it('injects --session-id into a claude argv in place and returns true', () => {
    const cmd = ['claude', '-p', '/review 5'];
    expect(injectSessionId(cmd, 'abc-123')).toBe(true);
    expect(cmd.slice(0, 3)).toEqual(['claude', '--session-id', 'abc-123']);
    expect(cmd[cmd.length - 1]).toBe('/review 5');
  });

  it('matches claude by basename of an absolute path', () => {
    const cmd = ['/usr/local/bin/claude', '-p', '/review 5'];
    expect(injectSessionId(cmd, 'sid')).toBe(true);
    expect(cmd.slice(1, 3)).toEqual(['--session-id', 'sid']);
  });

  it('skips a non-claude command unchanged', () => {
    const cmd = ['mytool', '-p', '/review 5'];
    expect(injectSessionId(cmd, 'abc')).toBe(false);
    expect(cmd).toEqual(['mytool', '-p', '/review 5']);
  });

  it('skips when a session/resume/persistence flag is already present', () => {
    for (const flag of [
      '--session-id',
      '--resume',
      '-r',
      '--continue',
      '-c',
      '--no-session-persistence',
    ]) {
      const cmd = ['claude', flag, 'x', '-p', '/review 5'];
      expect(injectSessionId(cmd, 'abc')).toBe(false);
    }
  });

  it('returns false on an empty command without throwing', () => {
    expect(injectSessionId([], 'abc')).toBe(false);
  });
});

describe('claudeTranscriptPath', () => {
  it('slugifies the absolute cwd (slashes and dots → dashes) and names the file by id', () => {
    const path = claudeTranscriptPath('/repo/.git-worktrees/issue-1', 'the-sid');
    expect(path).toContain('-repo--git-worktrees-issue-1');
    expect(path).toContain(`${homedir()}/.claude/projects/`);
    expect(path.endsWith('/the-sid.jsonl')).toBe(true);
  });
});

describe('dispatchEnv', () => {
  const base = { SENTINEL: 'y' } as NodeJS.ProcessEnv;

  it('omits resume vars on a plain dispatch but inherits the base env', () => {
    const env = dispatchEnv({ base });
    expect(env.SENTINEL).toBe('y');
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBeUndefined();
    expect(env[ENV_PREVIOUS_TRANSCRIPT_PATH]).toBeUndefined();
  });

  it('exports both resume vars when a full previous locator is given', () => {
    const env = dispatchEnv({ base, previous: { sessionId: 'old-1', path: '/x/old-1.jsonl' } });
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBe('old-1');
    expect(env[ENV_PREVIOUS_TRANSCRIPT_PATH]).toBe('/x/old-1.jsonl');
  });

  it('exports only the known half of a partial previous locator', () => {
    const env = dispatchEnv({ base, previous: { sessionId: 'old-1' } });
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBe('old-1');
    expect(env[ENV_PREVIOUS_TRANSCRIPT_PATH]).toBeUndefined();
  });

  it('exports traceability vars only when supplied', () => {
    const env = dispatchEnv({ base, transcriptId: 'sid-9' });
    expect(env[ENV_AGENT_TRANSCRIPT_ID]).toBe('sid-9');
    expect(env[ENV_COORDINATOR_STARTED_AT]).toBeUndefined();
  });

  it('strips inherited resume/traceability vars when not re-supplied', () => {
    const dirty = {
      [ENV_PREVIOUS_TRANSCRIPT_ID]: 'coord-sid',
      [ENV_PREVIOUS_TRANSCRIPT_PATH]: '/x/coord-sid.jsonl',
      [ENV_COORDINATOR_STARTED_AT]: '2026-06-19T00:00:00+00:00',
    } as NodeJS.ProcessEnv;
    const env = dispatchEnv({ base: dirty });
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBeUndefined();
    expect(env[ENV_PREVIOUS_TRANSCRIPT_PATH]).toBeUndefined();
    expect(env[ENV_COORDINATOR_STARTED_AT]).toBeUndefined();
  });

  it('lets explicit args override inherited resume vars', () => {
    const dirty = {
      [ENV_PREVIOUS_TRANSCRIPT_ID]: 'coord-sid',
      [ENV_COORDINATOR_STARTED_AT]: '2026-06-19T00:00:00+00:00',
    } as NodeJS.ProcessEnv;
    const env = dispatchEnv({
      base: dirty,
      previous: { sessionId: 'retry-sid', path: '/x/retry-sid.jsonl' },
      coordinatorStartedAt: '2026-06-20T00:00:00+00:00',
    });
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBe('retry-sid');
    expect(env[ENV_PREVIOUS_TRANSCRIPT_PATH]).toBe('/x/retry-sid.jsonl');
    expect(env[ENV_COORDINATOR_STARTED_AT]).toBe('2026-06-20T00:00:00+00:00');
  });
});

describe('TranscriptResumeRegistry', () => {
  it('flag_retry promotes the last locator to pending, take_pending consumes it', () => {
    const reg = new TranscriptResumeRegistry();
    reg.record(5, 'sid-a', '/p/sid-a.jsonl');
    reg.flagRetry(5);
    expect(reg.takePending(5)).toEqual({ sessionId: 'sid-a', path: '/p/sid-a.jsonl' });
    expect(reg.takePending(5)).toBeNull();
  });

  it('flagRetry without a prior dispatch is a no-op', () => {
    const reg = new TranscriptResumeRegistry();
    reg.flagRetry(9);
    expect(reg.takePending(9)).toBeNull();
  });

  it('record overwrites the last locator', () => {
    const reg = new TranscriptResumeRegistry();
    reg.record(5, 'old', '/p/old.jsonl');
    reg.record(5, 'new', '/p/new.jsonl');
    reg.flagRetry(5);
    expect(reg.takePending(5)?.sessionId).toBe('new');
  });

  it('lastFor reads without consuming', () => {
    const reg = new TranscriptResumeRegistry();
    reg.record(5, 'sid-a', '/p/sid-a.jsonl');
    expect(reg.lastFor(5)?.sessionId).toBe('sid-a');
    expect(reg.lastFor(5)?.sessionId).toBe('sid-a');
    expect(reg.lastFor(99)).toBeNull();
  });
});

describe('defaultSkillRunner', () => {
  beforeEach(() => boundedRun.mockReset());

  it('builds the argv, forwards cwd + env to boundedRun, and reports ok on exit 0', async () => {
    boundedRun.mockResolvedValueOnce(run({ stdout: 'done' }));
    const env = { FOO: 'bar' } as NodeJS.ProcessEnv;
    const r = await defaultSkillRunner(
      { skill: '/review 7', cwd: '/repo' },
      { env, timeoutMs: 1000 },
    );
    expect(r).toMatchObject({ stdout: 'done', ok: true });
    expect(boundedRun).toHaveBeenCalledWith(
      'claude',
      ['--', '/review 7'],
      expect.objectContaining({ cwd: '/repo', env, timeoutMs: 1000 }),
    );
  });

  it('soft-fails to ok=false on a spawn rejection', async () => {
    boundedRun.mockRejectedValueOnce(new Error('spawn ENOENT'));
    const r = await defaultSkillRunner({ skill: 's' }, {});
    expect(r).toMatchObject({ ok: false, code: null, stderr: 'spawn ENOENT' });
  });
});

describe('dispatchSkill', () => {
  beforeEach(() => boundedRun.mockReset());

  const fakeRun = () => vi.fn(async () => run({ stdout: 'ok' }));

  it('pins the session id into extraArgs and records the locator', async () => {
    const reg = new TranscriptResumeRegistry();
    const store = memStore();
    const runner = fakeRun();
    const res = await dispatchSkill({
      invocation: { skill: '/review 7', cwd: '/repo', extraArgs: ['-p'] },
      pr: 7,
      sessionId: 'sid-1',
      registry: reg,
      store,
      run: runner,
    });
    const [inv] = runner.mock.calls[0]!;
    expect(inv.extraArgs).toEqual(['--session-id', 'sid-1', '-p']);
    expect(res.sessionId).toBe('sid-1');
    expect(res.transcriptPath.endsWith('/sid-1.jsonl')).toBe(true);
    expect(reg.lastFor(7)?.sessionId).toBe('sid-1');
  });

  it('does not export previous resume vars on a first (non-retry) dispatch', async () => {
    const runner = fakeRun();
    await dispatchSkill({
      invocation: { skill: '/review 7', cwd: '/repo' },
      pr: 7,
      sessionId: 'sid-1',
      registry: new TranscriptResumeRegistry(),
      store: memStore(),
      run: runner,
    });
    const env = runner.mock.calls[0]![1].env!;
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBeUndefined();
    expect(env[ENV_AGENT_TRANSCRIPT_ID]).toBe('sid-1');
  });

  it('inherits a pending in-memory locator on a retry dispatch', async () => {
    const reg = new TranscriptResumeRegistry();
    reg.record(7, 'prev-sid', '/p/prev-sid.jsonl');
    reg.flagRetry(7);
    const runner = fakeRun();
    await dispatchSkill({
      invocation: { skill: '/review 7', cwd: '/repo' },
      pr: 7,
      sessionId: 'sid-2',
      registry: reg,
      store: memStore(),
      run: runner,
    });
    const env = runner.mock.calls[0]![1].env!;
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBe('prev-sid');
    expect(env[ENV_PREVIOUS_TRANSCRIPT_PATH]).toBe('/p/prev-sid.jsonl');
  });

  it('recovers a durable marker from the store when no in-memory pending exists', async () => {
    const marker =
      '<!-- coordinator-resume-pointer: {"transcript_id":"durable-sid","transcript_path":"/d/durable-sid.jsonl"} -->';
    const store = memStore([{ body: marker, createdAt: '2026-06-20T00:00:00Z' }]);
    const runner = fakeRun();
    await dispatchSkill({
      invocation: { skill: '/review 7', cwd: '/repo' },
      pr: 7,
      sessionId: 'sid-3',
      registry: new TranscriptResumeRegistry(),
      store,
      run: runner,
    });
    const env = runner.mock.calls[0]![1].env!;
    expect(env[ENV_PREVIOUS_TRANSCRIPT_ID]).toBe('durable-sid');
  });

  it('persists a durable timeout marker when the run times out', async () => {
    const store = memStore();
    const runner = vi.fn(async () => run({ code: null, timedOut: true }));
    const res = await dispatchSkill({
      invocation: { skill: '/review 7', cwd: '/repo' },
      pr: 7,
      sessionId: 'sid-4',
      registry: new TranscriptResumeRegistry(),
      store,
      run: runner,
      model: 'Claude Opus 4.8',
    });
    expect(res.timedOut).toBe(true);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.body).toContain('sid-4');
    expect(store.entries[0]!.body).toContain('coordinator-resume-pointer');
  });

  it('writes no marker on a clean (non-timeout) run', async () => {
    const store = memStore();
    await dispatchSkill({
      invocation: { skill: '/review 7', cwd: '/repo' },
      pr: 7,
      sessionId: 'sid-5',
      registry: new TranscriptResumeRegistry(),
      store,
      run: fakeRun(),
    });
    expect(store.entries).toHaveLength(0);
  });
});
