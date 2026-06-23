/**
 * Classify CI workflow command segments into locally-runnable check categories.
 *
 * Answers "what does this command mean?" given a raw workflow `run:` segment:
 * determines whether it is a locally-runnable check (format / lint / typecheck /
 * test), and if so, which category and which underlying tool. Pure — no I/O.
 *
 * TS port of dotfiles' `lib/command_classifier.py`.
 */

/** A locally-runnable check category, in canonical run order. */
export type Category = 'format' | 'lint' | 'typecheck' | 'test';

/** Canonical display/run order of the check categories. */
export const CATEGORY_ORDER: readonly Category[] = ['format', 'lint', 'typecheck', 'test'];

/** A single locally-runnable CI check derived from a workflow run step. */
export interface Check {
  category: Category;
  /** Original command segment, executed verbatim. */
  command: string;
  /** Underlying tool/script name, for display + availability. */
  tool: string;
}

// Runner/wrapper prefixes stripped (longest first) before classifying the
// underlying tool. The original command is still what gets executed.
const RUNNER_PREFIXES: readonly string[][] = [
  ['pnpm', 'exec'],
  ['pnpm', 'dlx'],
  ['pnpm', 'run'],
  ['npm', 'exec'],
  ['npm', 'run'],
  ['yarn', 'run'],
  ['npx', '--no-install'],
  ['npx', '--yes'],
  ['npx'],
  ['poetry', 'run'],
  ['python3', '-m'],
  ['python', '-m'],
  ['pnpm'],
  ['npm'],
  ['yarn'],
];

// package.json script names mapped to a category (only unambiguous, read-only
// ones — bare `format` is excluded because it usually writes).
const SCRIPT_CATEGORIES: Record<string, Category> = {
  'format:check': 'format',
  'format-check': 'format',
  lint: 'lint',
  typecheck: 'typecheck',
  tsc: 'typecheck',
  test: 'test',
};

/**
 * Tokenize a command like POSIX `shlex.split` with comment stripping: split on
 * whitespace, honor single/double quotes and backslash escapes, and treat an
 * unquoted `#` as the start of a comment. Returns `null` on an unbalanced quote
 * (mirrors Python's `shlex` raising `ValueError`).
 */
function shlexSplit(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '\\' && i + 1 < command.length) {
        current += command[++i]!;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === '\\' && i + 1 < command.length) {
      current += command[++i]!;
      hasToken = true;
    } else if (ch === '#') {
      break; // start of comment — discard the rest
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
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
  if (quote) return null; // unbalanced quote
  if (hasToken) tokens.push(current);
  return tokens;
}

/**
 * Strip one leading runner prefix (longest match) so the remaining tokens start
 * with the underlying tool or script name.
 */
function stripRunner(tokens: string[]): string[] {
  for (const prefix of RUNNER_PREFIXES) {
    if (tokens.length > prefix.length && prefix.every((tok, i) => tokens[i] === tok)) {
      return tokens.slice(prefix.length);
    }
  }
  return tokens;
}

/**
 * Classify a command segment into a {@link Check}, or `null` if it is not a
 * locally-runnable CI check. Write-mode formatters (`black .`, `prettier
 * --write`, `ruff format` without `--check`) return `null` — the gate never
 * rewrites files.
 */
export function classifyCommand(command: string): Check | null {
  const tokens = shlexSplit(command);
  if (!tokens || tokens.length === 0) return null;
  const remainder = stripRunner(tokens);
  const head = remainder[0];
  if (head === undefined) return null;
  const rest = remainder.slice(1);

  // Format — require an explicit read-only --check so we never run a write-mode
  // formatter (e.g. `black .` / `prettier --write`).
  if (head === 'prettier' && rest.includes('--check'))
    return { category: 'format', command, tool: 'prettier' };
  if (head === 'black' && rest.includes('--check'))
    return { category: 'format', command, tool: 'black' };

  // Ruff — `ruff check …` is a linter; `ruff format --check` is a read-only
  // format check. Write-mode `ruff format` (no --check) is never run.
  if (head === 'ruff') {
    const sub = rest[0] ?? '';
    if (sub === 'check') return { category: 'lint', command, tool: 'ruff' };
    if (sub === 'format' && rest.includes('--check'))
      return { category: 'format', command, tool: 'ruff' };
    return null;
  }

  // Lint / typecheck / test tools.
  if (head === 'pylint' || head === 'eslint') return { category: 'lint', command, tool: head };
  if (head === 'tsc') return { category: 'typecheck', command, tool: 'tsc' };
  if (head === 'pytest') return { category: 'test', command, tool: 'pytest' };
  if (head === 'unittest') return { category: 'test', command, tool: 'unittest' };
  if (head === 'vitest') return { category: 'test', command, tool: 'vitest' };

  // package.json script names (after stripping the package-manager prefix).
  const scriptCategory = SCRIPT_CATEGORIES[head];
  if (scriptCategory !== undefined) return { category: scriptCategory, command, tool: head };

  return null;
}
