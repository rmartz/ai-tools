import { describe, it, expect, vi, beforeEach } from 'vitest';

// `claude` is a real-world boundary — mock the runtime so the test is hermetic
// (deny-by-default subprocess; the spirit of dotfiles' _hermetic.py). Mock the
// path the source imports from.
const boundedRun = vi.fn();
vi.mock('../src/bounded-subprocess.js', () => ({ boundedRun }));

const result = (over: Partial<{ stdout: string; stderr: string; code: number | null }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over,
});

const { buildArgv, runInvocation, fromTemplate } = await import('../src/claude-invoke.js');

describe('buildArgv', () => {
  it('defaults the binary and always terminates options with `--` before the prompt', () => {
    expect(buildArgv({ skill: '/review 7' })).toEqual(['claude', '--', '/review 7']);
  });

  it('emits --print and a comma-joined --allowedTools before the terminator', () => {
    expect(
      buildArgv({
        skill: '/merge 64',
        printMode: true,
        allowedTools: ['Bash', 'Read', 'mcp__github__*'],
      }),
    ).toEqual([
      'claude',
      '--print',
      '--allowedTools',
      'Bash,Read,mcp__github__*',
      '--',
      '/merge 64',
    ]);
  });

  it('keeps the prompt after `--` so a variadic --allowedTools cannot swallow it', () => {
    const argv = buildArgv({ skill: '/merge 64', allowedTools: ['Bash'] });
    expect(argv[argv.length - 2]).toBe('--');
    expect(argv[argv.length - 1]).toBe('/merge 64');
  });

  it('omits --allowedTools when the list is empty', () => {
    expect(buildArgv({ skill: 's', allowedTools: [] })).toEqual(['claude', '--', 's']);
  });

  it('honors a custom binary and inserts extraArgs between it and the mode flags', () => {
    expect(
      buildArgv({
        skill: 's',
        binary: '/opt/claude',
        extraArgs: ['--model', 'opus'],
        printMode: true,
      }),
    ).toEqual(['/opt/claude', '--model', 'opus', '--print', '--', 's']);
  });
});

describe('runInvocation', () => {
  beforeEach(() => boundedRun.mockReset());

  it('runs the built argv and reports ok on a zero exit', async () => {
    boundedRun.mockResolvedValueOnce(result({ stdout: 'done' }));
    const r = await runInvocation({ skill: '/merge 1', printMode: true, cwd: '/repo' });
    expect(r).toMatchObject({ stdout: 'done', code: 0, ok: true, timedOut: false });
    expect(boundedRun).toHaveBeenCalledWith(
      'claude',
      ['--print', '--', '/merge 1'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('soft-fails (ok=false) on a non-zero exit without throwing', async () => {
    boundedRun.mockResolvedValueOnce(result({ stderr: 'boom', code: 1 }));
    const r = await runInvocation({ skill: 's' });
    expect(r).toMatchObject({ ok: false, code: 1, stderr: 'boom' });
  });

  it('reports a timeout as not-ok', async () => {
    boundedRun.mockResolvedValueOnce(result({ code: null, timedOut: true }));
    const r = await runInvocation({ skill: 's' });
    expect(r).toMatchObject({ ok: false, timedOut: true });
  });

  it('soft-fails to ok=false on a spawn rejection', async () => {
    boundedRun.mockRejectedValueOnce(new Error('spawn ENOENT'));
    const r = await runInvocation({ skill: 's' });
    expect(r).toMatchObject({ ok: false, code: null, stderr: 'spawn ENOENT' });
  });
});

describe('fromTemplate', () => {
  it('parses a static template into binary + extraArgs with the skill last', () => {
    const inv = fromTemplate({ template: 'claude --model opus "{skill}"', skill: '/merge 5' });
    expect(inv).toMatchObject({
      binary: 'claude',
      extraArgs: ['--model', 'opus'],
      skill: '/merge 5',
    });
  });

  it('forwards extra substitutions and preserves a skill containing spaces', () => {
    const inv = fromTemplate({
      template: 'claude --repo {repo} "{skill}"',
      skill: '/review 9',
      substitutions: { repo: 'o/r' },
    });
    expect(inv.extraArgs).toEqual(['--repo', 'o/r']);
    expect(inv.skill).toBe('/review 9');
  });

  it('throws when the substituted skill is not the last token', () => {
    expect(() => fromTemplate({ template: 'claude "{skill}" --print', skill: '/x' })).toThrow(
      /last token must be the substituted skill/,
    );
  });

  it('throws when the template supplies its own `--` terminator', () => {
    expect(() => fromTemplate({ template: 'claude -- "{skill}"', skill: '/x' })).toThrow(
      /must not contain its own/,
    );
  });

  it('throws on an empty template', () => {
    expect(() => fromTemplate({ template: '   ', skill: '/x' })).toThrow(/empty argv/);
  });

  it('throws on an unknown placeholder', () => {
    expect(() => fromTemplate({ template: 'claude {repo} "{skill}"', skill: '/x' })).toThrow(
      /unknown placeholder \{repo\}/,
    );
  });

  it('throws on an unterminated quote', () => {
    expect(() => fromTemplate({ template: 'claude "{skill}', skill: '/x' })).toThrow(
      /unterminated quote/,
    );
  });
});
