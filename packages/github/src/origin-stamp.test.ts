import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { BoundedResult } from '@rmartz/agent-runtime';

vi.mock('@rmartz/agent-runtime', () => ({ boundedRun: vi.fn() }));
import { boundedRun } from '@rmartz/agent-runtime';

import {
  parseHookPayload,
  extractCreatedNumber,
  renderStamp,
  hasOriginMarker,
  applyStamp,
  resolveOriginRepo,
  stampOriginRepo,
} from './origin-stamp.js';

const runMock = boundedRun as Mock;

function ok(stdout: string): BoundedResult {
  return { stdout, stderr: '', code: 0, timedOut: false };
}

/** A `PostToolUse` payload for a create tool. */
function makePayload(toolName: string, input: unknown, response: unknown): string {
  return JSON.stringify({ tool_name: toolName, tool_input: input, tool_response: response });
}

beforeEach(() => {
  runMock.mockReset();
});

describe('parseHookPayload', () => {
  it('resolves a PR create to its kind, target repo, and number', () => {
    const payload = makePayload(
      'mcp__github__create_pull_request',
      { owner: 'rmartz', repo: 'other', title: 't' },
      { number: 42, html_url: 'https://github.com/rmartz/other/pull/42' },
    );
    expect(parseHookPayload(payload)).toEqual({
      kind: 'pr',
      targetRepo: 'rmartz/other',
      number: '42',
    });
  });

  it('resolves an issue_write create', () => {
    const payload = makePayload(
      'mcp__github__issue_write',
      { owner: 'rmartz', repo: 'ai-tools', method: 'create' },
      { number: 7 },
    );
    expect(parseHookPayload(payload)).toEqual({
      kind: 'issue',
      targetRepo: 'rmartz/ai-tools',
      number: '7',
    });
  });

  it('skips an issue_write update (only a create mints a new artifact)', () => {
    const payload = makePayload(
      'mcp__github__issue_write',
      { owner: 'rmartz', repo: 'ai-tools', method: 'update', issue_number: 7 },
      { number: 7 },
    );
    expect(parseHookPayload(payload)).toBeNull();
  });

  it('skips an unrelated tool', () => {
    const payload = makePayload(
      'mcp__github__add_issue_comment',
      { owner: 'a', repo: 'b' },
      { number: 1 },
    );
    expect(parseHookPayload(payload)).toBeNull();
  });

  it('skips when the target owner/repo is missing', () => {
    const payload = makePayload(
      'mcp__github__create_pull_request',
      { owner: 'rmartz' },
      { number: 42 },
    );
    expect(parseHookPayload(payload)).toBeNull();
  });

  it('skips a failed create with no resolvable number', () => {
    const payload = makePayload(
      'mcp__github__create_pull_request',
      { owner: 'rmartz', repo: 'other' },
      { error: 'validation failed' },
    );
    expect(parseHookPayload(payload)).toBeNull();
  });

  it('soft-fails on malformed JSON', () => {
    expect(parseHookPayload('{not json')).toBeNull();
  });
});

describe('extractCreatedNumber', () => {
  it('reads a structured number field', () => {
    expect(extractCreatedNumber({ number: 42 })).toBe('42');
  });

  it('falls back to parsing html_url', () => {
    expect(extractCreatedNumber({ html_url: 'https://github.com/o/r/pull/13' })).toBe('13');
  });

  it('unwraps an MCP content envelope carrying JSON text', () => {
    const response = { content: [{ type: 'text', text: JSON.stringify({ number: 99 }) }] };
    expect(extractCreatedNumber(response)).toBe('99');
  });

  it('scans a raw string for an issue URL', () => {
    expect(extractCreatedNumber('Created https://github.com/o/r/issues/5 ok')).toBe('5');
  });

  it('returns null when no number is present', () => {
    expect(extractCreatedNumber({ status: 'ok' })).toBeNull();
  });
});

describe('renderStamp / applyStamp', () => {
  it('emits only a footer (no banner) when origin equals target', () => {
    const { banner, footer } = renderStamp('pr', 'rmartz/ai-tools', 'rmartz/ai-tools');
    expect(banner).toBeNull();
    expect(footer).toContain('<!-- agent-origin: rmartz/ai-tools -->');
    expect(footer).toContain('🧭 **Agent origin:** `rmartz/ai-tools`');
  });

  it('emits a cross-repo banner naming both repos when origin differs from target', () => {
    const { banner } = renderStamp('pr', 'rmartz/ai-tools', 'rmartz/other');
    expect(banner).toContain('Cross-repo PR');
    expect(banner).toContain('`rmartz/ai-tools`');
    expect(banner).toContain('`rmartz/other`');
  });

  it('uses the issue noun in the banner for an issue', () => {
    expect(renderStamp('issue', 'a/b', 'c/d').banner).toContain('Cross-repo issue');
  });

  it('appends the footer and prepends the banner on a cross-repo create', () => {
    const out = applyStamp('Original body.', 'pr', 'rmartz/ai-tools', 'rmartz/other');
    expect(out).not.toBeNull();
    expect(out?.startsWith('> ⚠️ **Cross-repo PR:**')).toBe(true);
    expect(out).toContain('Original body.');
    expect(out?.trimEnd().endsWith('🧭 **Agent origin:** `rmartz/ai-tools`')).toBe(true);
  });

  it('appends only the footer on a same-repo create (no banner prefix)', () => {
    const out = applyStamp('Body', 'issue', 'rmartz/ai-tools', 'rmartz/ai-tools');
    expect(out?.startsWith('Body')).toBe(true);
    expect(out).toContain('<!-- agent-origin: rmartz/ai-tools -->');
    expect(out).not.toContain('Cross-repo');
  });

  it('is idempotent: returns null when the body is already stamped', () => {
    const once = applyStamp('Body', 'pr', 'a/b', 'a/b');
    expect(once).not.toBeNull();
    expect(hasOriginMarker(once as string)).toBe(true);
    expect(applyStamp(once as string, 'pr', 'a/b', 'a/b')).toBeNull();
  });
});

describe('resolveOriginRepo', () => {
  it('resolves the slug from an explicit projectDir remote', async () => {
    runMock.mockResolvedValue(ok('git@github.com:rmartz/ai-tools.git\n'));
    await expect(resolveOriginRepo({ projectDir: '/repo' })).resolves.toBe('rmartz/ai-tools');
    expect(runMock).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'remote', 'get-url', 'origin'],
      expect.anything(),
    );
  });

  it('falls back to CLAUDE_PROJECT_DIR from the env', async () => {
    runMock.mockResolvedValue(ok('https://github.com/rmartz/ai.git\n'));
    await expect(resolveOriginRepo({ env: { CLAUDE_PROJECT_DIR: '/proj' } })).resolves.toBe(
      'rmartz/ai',
    );
  });

  it('returns null when no project dir is known', async () => {
    await expect(resolveOriginRepo({ env: {} })).resolves.toBeNull();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns null when the repo has no origin remote', async () => {
    runMock.mockResolvedValue({ stdout: '', stderr: 'no such remote', code: 2, timedOut: false });
    await expect(resolveOriginRepo({ projectDir: '/repo' })).resolves.toBeNull();
  });
});

describe('stampOriginRepo (orchestration smoke)', () => {
  it('parses, resolves origin, fetches, stamps, and edits a cross-repo PR body', async () => {
    let patchedBody = '';
    runMock.mockImplementation(
      (cmd: string, args: string[], opts?: { input?: string }): Promise<BoundedResult> => {
        if (cmd === 'git') return Promise.resolve(ok('git@github.com:rmartz/ai-tools.git\n'));
        if (args.includes('PATCH')) {
          patchedBody = (JSON.parse(opts?.input ?? '{}') as { body: string }).body;
          return Promise.resolve(ok('https://github.com/rmartz/other/pull/9\n'));
        }
        return Promise.resolve(ok('Existing body\n')); // the GET
      },
    );

    const payload = makePayload(
      'mcp__github__create_pull_request',
      { owner: 'rmartz', repo: 'other', title: 't' },
      { number: 9 },
    );
    const outcome = await stampOriginRepo(payload, { projectDir: '/repo' });

    expect(outcome).toEqual({
      status: 'stamped',
      kind: 'pr',
      number: '9',
      originRepo: 'rmartz/ai-tools',
      targetRepo: 'rmartz/other',
      crossRepo: true,
    });
    expect(patchedBody).toContain('Existing body');
    expect(patchedBody).toContain('Cross-repo PR');
    expect(patchedBody).toContain('<!-- agent-origin: rmartz/ai-tools -->');
  });

  it('skips (no edit) when the payload is not a handled create', async () => {
    const outcome = await stampOriginRepo(makePayload('mcp__github__get_me', {}, {}));
    expect(outcome).toEqual({ status: 'skipped', reason: 'not-a-handled-create' });
    expect(runMock).not.toHaveBeenCalled();
  });
});
