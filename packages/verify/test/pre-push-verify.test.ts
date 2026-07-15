import { describe, it, expect, vi } from 'vitest';
import type * as AgentRuntime from '@rmartz/agent-runtime';

vi.mock('@rmartz/agent-runtime', async () => {
  const actual = await vi.importActual<typeof AgentRuntime>('@rmartz/agent-runtime');
  // Keep the real classifyCommand/CATEGORY_ORDER; only the subprocess boundary
  // is mocked so no command ever executes.
  return { ...actual, boundedRun: vi.fn() };
});

import { tokenize, resolveArgv, runCheck, verify, anyFailed } from '../src/pre-push-verify.js';
import type { CommandRunner, VerifyOptions } from '../src/pre-push-verify.js';
import type { WorkflowFs } from '../src/workflow-checks.js';
import type { Check } from '@rmartz/agent-runtime';

describe('tokenize', () => {
  it('splits on whitespace honoring quotes', () => {
    expect(tokenize(`prettier --check "src/a b.ts"`)).toEqual([
      'prettier',
      '--check',
      'src/a b.ts',
    ]);
  });

  it('returns null on an unbalanced quote', () => {
    expect(tokenize(`prettier "oops`)).toBeNull();
  });
});

// A resolver that pretends every tool lives at /bin/<tool>.
const everyToolResolves: VerifyOptions['resolve'] = {
  exists: (p) => p.startsWith('/bin/'),
  path: '/bin',
  pathDelimiter: ':',
};

describe('resolveArgv', () => {
  it('prefixes the resolved tool and preserves the verbatim args', () => {
    const argv = resolveArgv('prettier --check .', '/repo', everyToolResolves);
    expect(argv).toEqual(['/bin/prettier', '--check', '.']);
  });

  it('returns null when the tool cannot be resolved', () => {
    const argv = resolveArgv('prettier --check .', '/repo', {
      exists: () => false,
      path: '',
      pathDelimiter: ':',
    });
    expect(argv).toBeNull();
  });
});

const check = (over: Partial<Check> = {}): Check => ({
  category: 'format',
  command: 'prettier --check .',
  tool: 'prettier',
  ...over,
});

describe('runCheck', () => {
  it('reports a passing check', async () => {
    const runner: CommandRunner = async () => ({ stdout: 'all good', stderr: '', code: 0 });
    const r = await runCheck(check(), '/repo', { resolve: everyToolResolves, runner });
    expect(r.status).toBe('pass');
    expect(r.output).toBe('all good');
  });

  it('reports a failing check and captures combined output', async () => {
    const runner: CommandRunner = async () => ({ stdout: 'out', stderr: 'err', code: 1 });
    const r = await runCheck(check(), '/repo', { resolve: everyToolResolves, runner });
    expect(r.status).toBe('fail');
    expect(r.returncode).toBe(1);
    expect(r.output).toBe('outerr');
  });

  it('skips a check whose tool is unavailable, without running it', async () => {
    const runner = vi.fn<CommandRunner>(async () => ({ stdout: '', stderr: '', code: 0 }));
    const r = await runCheck(check(), '/repo', {
      resolve: { exists: () => false, path: '', pathDelimiter: ':' },
      runner,
    });
    expect(r.status).toBe('skipped');
    expect(r.output).toContain('tool unavailable');
    expect(runner).not.toHaveBeenCalled();
  });
});

function fsFrom(files: Record<string, string>): WorkflowFs {
  return {
    readdir: () => Object.keys(files),
    readFile: (path) => {
      const name = path.split('/').pop()!;
      return files[name] ?? '';
    },
  };
}

const WORKFLOW = `
jobs:
  j:
    steps:
      - run: pnpm exec prettier --check .
      - run: pnpm exec tsc --noEmit
`;

describe('verify', () => {
  it('runs the selected checks in order and surfaces failures', async () => {
    const runner: CommandRunner = async (argv) => {
      const failing = argv.some((a) => a.includes('tsc'));
      return { stdout: '', stderr: failing ? 'type error' : '', code: failing ? 1 : 0 };
    };
    const results = await verify('/repo', {
      fs: fsFrom({ 'ci.yml': WORKFLOW }),
      resolve: everyToolResolves,
      runner,
    });
    expect(results.map((r) => r.check.category)).toEqual(['format', 'typecheck']);
    expect(results.map((r) => r.status)).toEqual(['pass', 'fail']);
    expect(anyFailed(results)).toBe(true);
  });

  it('returns an empty result set when no locally-runnable check is detected', async () => {
    const results = await verify('/repo', {
      fs: fsFrom({ 'ci.yml': 'jobs:\n  j:\n    steps:\n      - run: pnpm install\n' }),
      resolve: everyToolResolves,
    });
    expect(results).toEqual([]);
    expect(anyFailed(results)).toBe(false);
  });
});
