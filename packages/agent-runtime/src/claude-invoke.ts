import { boundedRun } from './bounded-subprocess.js';

/**
 * Structured headless `claude` CLI invocation.
 *
 * Every place that shells out to the `claude` binary should build its argv
 * through {@link buildArgv} so the inevitable next CLI quirk is fixed once.
 * The prompt (`skill`) is always emitted **after** a `--` terminator so a
 * variadic option above it (notably `--allowedTools`, which commander.js keeps
 * consuming positionals for until the next dashed flag) cannot swallow it.
 * Regression for rmartz/dotfiles#140.
 *
 * Fields are split: `skill`, `printMode`, `allowedTools`, `binary`,
 * `extraArgs` shape the argv (pure); `cwd` only affects the subprocess.
 */
export interface ClaudeInvocation {
  /** The Claude prompt — e.g. `"/merge 42"`. Becomes the last positional. */
  skill: string;
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Add `--print` for non-interactive output. */
  printMode?: boolean;
  /** Tool names emitted as a comma-separated `--allowedTools` value. */
  allowedTools?: readonly string[];
  /** The `claude` executable path. Override for testing or wrapper scripts. */
  binary?: string;
  /** Extra flags inserted between the binary and `--print`/`--allowedTools`. */
  extraArgs?: readonly string[];
}

/**
 * Build the argv for an invocation. Pure — no I/O, fully unit-testable.
 *
 * Always emits `--` immediately before the prompt so a variadic option above
 * cannot consume it. The `--allowedTools` value is comma-joined.
 */
export function buildArgv(invocation: ClaudeInvocation): string[] {
  const { skill, printMode, allowedTools, binary = 'claude', extraArgs = [] } = invocation;
  const argv = [binary, ...extraArgs];
  if (printMode) argv.push('--print');
  if (allowedTools && allowedTools.length > 0) {
    argv.push('--allowedTools', allowedTools.join(','));
  }
  argv.push('--', skill);
  return argv;
}

export interface RunOptions {
  /** Hard wall-clock timeout. Defaults to 30 minutes for long skill runs. */
  timeoutMs?: number;
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  /** Exit code, or `null` if the process was killed (e.g. timed out). */
  code: number | null;
  timedOut: boolean;
  /** True when the process exited 0 and did not time out. */
  ok: boolean;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Execute an invocation via {@link boundedRun} and return the result.
 *
 * Soft-fail posture mirrors the Python `run`: a non-zero exit, a timeout, or a
 * spawn error all resolve to a result with `ok: false` rather than throwing, so
 * callers inspect `ok`/`code`/`stderr` instead of wrapping in try/catch.
 */
export async function runInvocation(
  invocation: ClaudeInvocation,
  options: RunOptions = {},
): Promise<ClaudeRunResult> {
  const [command, ...args] = buildArgv(invocation);
  if (command === undefined) {
    return { stdout: '', stderr: 'empty argv', code: null, timedOut: false, ok: false };
  }
  try {
    const r = await boundedRun(command, args, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: invocation.cwd,
    });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      code: r.code,
      timedOut: r.timedOut,
      ok: r.code === 0 && !r.timedOut,
    };
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr, code: null, timedOut: false, ok: false };
  }
}

export interface FromTemplateOptions {
  template: string;
  skill: string;
  cwd?: string;
  /** Extra `{name}` substitutions (e.g. `repo`, `repoPath`) for the template. */
  substitutions?: Readonly<Record<string, string>>;
}

/**
 * Build a {@link ClaudeInvocation} from a user-configurable template string
 * (the `--claude-command-template` argument that `poll-prs` accepts).
 *
 * The template must produce `binary [extraArgs ...] {skill}` after
 * substitution, with the substituted skill as the **last** token (quote
 * `"{skill}"` so a skill containing spaces stays one token). It must not
 * contain its own `--` terminator — `buildArgv` always inserts one before the
 * prompt, so a user `--` would strand later flags as positionals. Throws on any
 * of these violations.
 */
export function fromTemplate(options: FromTemplateOptions): ClaudeInvocation {
  const { template, skill, cwd, substitutions = {} } = options;
  const rendered = renderTemplate(template, { skill, ...substitutions });
  const tokens = splitTokens(rendered);
  if (tokens.length === 0) {
    throw new Error(`template produced empty argv: ${JSON.stringify(template)}`);
  }
  const last = tokens[tokens.length - 1];
  if (last !== skill) {
    throw new Error(
      `template's last token must be the substituted skill (got ${JSON.stringify(last)}); ` +
        `make sure {skill} is the last argument and quoted if it can contain spaces — ` +
        `template was ${JSON.stringify(template)}`,
    );
  }
  const extraArgs = tokens.slice(1, -1);
  if (extraArgs.includes('--')) {
    throw new Error(
      `template must not contain its own \`--\` option terminator; buildArgv always inserts ` +
        `\`--\` before the prompt, so a user-supplied \`--\` would strand later flags as ` +
        `positionals — template was ${JSON.stringify(template)}`,
    );
  }
  return { skill, cwd, binary: tokens[0], extraArgs };
}

/** Substitute `{name}` placeholders, throwing on an unknown placeholder. */
function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`template references unknown placeholder {${name}}`);
    }
    return value;
  });
}

/**
 * Minimal POSIX-ish word split honoring single and double quotes (the subset of
 * `shlex.split` templates use). Adjacent quoted/unquoted runs form one token,
 * so `"a b"c` is the single token `a bc`. Throws on an unterminated quote.
 */
function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }
    current += ch;
    inToken = true;
  }
  if (quote) throw new Error(`unterminated quote in template token: ${JSON.stringify(input)}`);
  if (inToken) tokens.push(current);
  return tokens;
}
