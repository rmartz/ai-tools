/**
 * Deterministic pre-push verification gate.
 *
 * Runs the *locally-runnable* subset of a project's CI checks before a push, so
 * agents catch preventable failures (lint / format / typecheck / unit tests)
 * locally instead of burning a CI run. Rather than guess each project's
 * commands, it reads the project's own `.github/workflows/*.yml`, extracts every
 * `run:` step, and re-runs the ones whose leading tool is a locally-runnable
 * check (classified by `@rmartz/agent-runtime`'s `classifyCommand`) — executing
 * the *actual* commands CI runs, so a pass faithfully predicts those CI checks.
 *
 * Behaviour (mirrors dotfiles' `pre_push_verify.py`):
 *   - A check passes / fails by its command's exit status.
 *   - A check whose tool is unavailable locally is reported skipped (a warning,
 *     not a failure), so a missing local tool never blocks the push.
 *   - No locally-runnable check detected → an empty result (the caller treats it
 *     as a skip, exit 0).
 *
 * Splitting half of the Python gate; workflow extraction lives in
 * `workflow-checks.ts`. All subprocess goes through `boundedRun`.
 */

import { boundedRun } from '@rmartz/agent-runtime';
import type { Check } from '@rmartz/agent-runtime';
import { resolveTool } from './tool-resolver.js';
import type { ResolveToolOptions } from './tool-resolver.js';
import { selectChecks } from './workflow-checks.js';
import type { WorkflowFs } from './workflow-checks.js';

// Generous wall-clock cap: a project's full test suite can be slow, but a check
// that runs longer than this is almost certainly hung, not working.
const CHECK_TIMEOUT_MS = 600_000;

/** The outcome of attempting to run one check. */
export interface CheckResult {
  check: Check;
  status: 'pass' | 'fail' | 'skipped';
  returncode: number | null;
  output: string;
}

/** Injectable subprocess boundary so tests never execute a real command. */
export type CommandRunner = (
  argv: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const defaultRunner: CommandRunner = async (argv, cwd) => {
  const [command, ...args] = argv;
  if (command === undefined) return { stdout: '', stderr: 'empty argv', code: 1 };
  const r = await boundedRun(command, args, { timeoutMs: CHECK_TIMEOUT_MS, cwd });
  return { stdout: r.stdout, stderr: r.stderr, code: r.code };
};

export interface VerifyOptions {
  /** Filesystem boundary for reading workflow files (testing). */
  fs?: WorkflowFs;
  /** Tool-resolution boundary (testing). */
  resolve?: ResolveToolOptions;
  /** Subprocess boundary (testing). */
  runner?: CommandRunner;
}

/**
 * Minimal shell tokenizer: split on whitespace honoring single/double quotes.
 * Returns `null` on an unbalanced quote. Sufficient for resolving the leading
 * tool of a workflow command; the original string's args are preserved verbatim.
 */
export function tokenize(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === ' ' || ch === '\t') {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (quote) return null;
  if (hasToken) tokens.push(current);
  return tokens;
}

/**
 * Resolve the argv to execute for a check command, or `null` when the tool
 * cannot run locally. The leading token is resolved via {@link resolveTool} (the
 * project's `node_modules/.bin` first, then PATH, then `pnpm exec`); the
 * remaining tokens are appended verbatim so the project's real targets and flags
 * are preserved exactly.
 */
export function resolveArgv(
  command: string,
  repoRoot: string,
  opts: ResolveToolOptions = {},
): string[] | null {
  const tokens = tokenize(command);
  if (!tokens || tokens.length === 0) return null;
  const [head, ...rest] = tokens;
  if (head === undefined) return null;
  const prefix = resolveTool(repoRoot, head, opts);
  if (prefix === null) return null;
  return [...prefix, ...rest];
}

/** Run a single check from the repo root and capture its outcome. */
export async function runCheck(
  check: Check,
  repoRoot: string,
  opts: VerifyOptions = {},
): Promise<CheckResult> {
  const argv = resolveArgv(check.command, repoRoot, opts.resolve);
  if (argv === null) {
    return {
      check,
      status: 'skipped',
      returncode: null,
      output: `tool unavailable: ${check.tool}`,
    };
  }
  const runner = opts.runner ?? defaultRunner;
  const { stdout, stderr, code } = await runner(argv, repoRoot);
  const status = code === 0 ? 'pass' : 'fail';
  const output = `${stdout || ''}${stderr || ''}`.trim();
  return { check, status, returncode: code, output };
}

/**
 * Run the full locally-runnable check set for `repoRoot` and return every
 * result, ordered format → lint → typecheck → test. An empty array means no
 * locally-runnable check was detected (the caller treats that as a clean skip).
 */
export async function verify(repoRoot: string, opts: VerifyOptions = {}): Promise<CheckResult[]> {
  const checks = selectChecks(repoRoot, opts.fs);
  const results: CheckResult[] = [];
  for (const check of checks) {
    results.push(await runCheck(check, repoRoot, opts));
  }
  return results;
}

/** Whether any check failed — the gate's exit-1 condition. */
export function anyFailed(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'fail');
}

/**
 * Resolve the git repo root for `cwd`, falling back to `cwd` itself when `git`
 * is unavailable or `cwd` is not in a repo. Subprocess via `boundedRun`.
 */
export async function detectRepoRoot(cwd: string): Promise<string> {
  try {
    const r = await boundedRun('git', ['rev-parse', '--show-toplevel'], {
      timeoutMs: 30_000,
      cwd,
    });
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {
    // git missing / cwd not a repo — fall through.
  }
  return cwd;
}
