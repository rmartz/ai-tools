import { readFileSync } from 'node:fs';
import { boundedRun } from '@rmartz/agent-runtime';

/**
 * Block commits that introduce merge-conflict markers.
 *
 * A botched conflict resolution can leave markers behind; nothing else stops
 * them being committed and pushed, so they were only caught at review time. This
 * checker is the commit-time guard (run as a git `pre-commit` hook) plus a CI
 * backstop. TS port of dotfiles' `check_conflict_markers.py`.
 *
 * Detection (full-triple, no doc special-casing): a file is flagged **only**
 * when it contains an unambiguous conflict **angle** marker — a line beginning
 * with seven `<` or seven `>` (`<<<<<<< HEAD`, `>>>>>>> branch`). These never
 * occur in normal source or Markdown. The separator line (seven `=`) and the
 * diff3 base line (seven `|`) are reported too, but **only** in a file that
 * already has an angle marker — so a Markdown setext underline or `=======`
 * divider is never a false positive.
 */

const GIT_TIMEOUT_MS = 30_000;

// Angle markers are unambiguous and flagged anywhere. Seven characters exactly,
// at line start, followed by whitespace or end-of-line.
const ANGLE_RE = /^(<<<<<<<|>>>>>>>)(\s|$)/;
// Separator / diff3-base lines. Only meaningful as conflict markers when an
// angle marker is also present in the same file (the full-triple rule), so a
// lone "=======" in docs is not mistaken for a conflict.
const MID_RE = /^(=======|\|\|\|\|\|\|\|)(\s|$)/;

/** A single conflict-marker line, 1-based line number. */
export interface MarkerLine {
  lineno: number;
  line: string;
}

/** A conflict-marker line attributed to a file path. */
export interface Violation extends MarkerLine {
  path: string;
}

/**
 * Return every conflict-marker line in `text`. Empty when the text has no angle
 * marker — the separator/base lines alone do not count, which is what keeps
 * Markdown `=======` underlines from being flagged. Line numbers are 1-based and
 * the result is sorted ascending.
 */
export function findConflictMarkers(text: string): MarkerLine[] {
  const lines = text.split('\n');
  const angles: MarkerLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (ANGLE_RE.test(line)) angles.push({ lineno: i + 1, line });
  }
  if (angles.length === 0) return [];
  const mids: MarkerLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (MID_RE.test(line)) mids.push({ lineno: i + 1, line });
  }
  return [...angles, ...mids].sort((a, b) => a.lineno - b.lineno);
}

/** How a path's content is resolved for scanning. */
export type ContentReader = (path: string) => Promise<string> | string;

export interface ScanOptions {
  cwd?: string;
}

async function runGit(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; code: number | null }> {
  const r = await boundedRun('git', args, { timeoutMs: GIT_TIMEOUT_MS, cwd });
  return { stdout: r.stdout, code: r.code };
}

function splitNul(stdout: string): string[] {
  return stdout.split('\0').filter((p) => p);
}

/** Paths added/copied/modified/renamed in the index (NUL-delimited for safety). */
export async function stagedFiles(opts: ScanOptions = {}): Promise<string[]> {
  const { stdout } = await runGit(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    opts.cwd,
  );
  return splitNul(stdout);
}

/** All git-tracked files (NUL-delimited). */
export async function trackedFiles(opts: ScanOptions = {}): Promise<string[]> {
  const { stdout } = await runGit(['ls-files', '-z'], opts.cwd);
  return splitNul(stdout);
}

/** Files changed vs `origin/main` (three-dot); empty if the ref is absent. */
export async function changedVsMain(opts: ScanOptions = {}): Promise<string[]> {
  const { stdout, code } = await runGit(
    ['diff', '--name-only', '--diff-filter=ACMR', '-z', 'origin/main...HEAD'],
    opts.cwd,
  );
  if (code !== 0) return [];
  return splitNul(stdout);
}

/** Staged blob content for `path`; empty string if binary or unreadable. */
export async function stagedContent(path: string, opts: ScanOptions = {}): Promise<string> {
  const { stdout, code } = await runGit(['show', `:${path}`], opts.cwd);
  if (code !== 0) return '';
  return stdout;
}

/** Worktree content for `path`; empty string if missing or undecodable. */
export function worktreeContent(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return ''; // missing or binary — no text markers to find
  }
}

/** Scan `paths`, reading each via `read`, and collect every marker violation. */
export async function scan(paths: string[], read: ContentReader): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const path of paths) {
    const text = await read(path);
    for (const { lineno, line } of findConflictMarkers(text)) {
      violations.push({ path, lineno, line });
    }
  }
  return violations;
}

export type Mode = '--staged' | '--check' | '--check-diff';

/** Resolve the path list and per-path reader for a mode. */
function readerFor(
  mode: Mode,
  opts: ScanOptions,
): { paths: () => Promise<string[]>; read: ContentReader } {
  if (mode === '--staged') {
    return { paths: () => stagedFiles(opts), read: (p) => stagedContent(p, opts) };
  }
  if (mode === '--check') {
    return { paths: () => trackedFiles(opts), read: worktreeContent };
  }
  return { paths: () => changedVsMain(opts), read: worktreeContent };
}

export interface CheckOptions extends ScanOptions {
  /** Env bag for the `ALLOW_CONFLICT_MARKERS` bypass (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * Run the checker for `mode` and return its violations. In `--staged` mode the
 * `ALLOW_CONFLICT_MARKERS` env var short-circuits to an empty result, mirroring
 * the Python bypass.
 */
export async function checkConflictMarkers(
  mode: Mode,
  opts: CheckOptions = {},
): Promise<Violation[]> {
  const env = opts.env ?? process.env;
  if (mode === '--staged' && env.ALLOW_CONFLICT_MARKERS) return [];
  const { paths, read } = readerFor(mode, opts);
  return scan(await paths(), read);
}

/** Render the violation report exactly as the Python checker printed it. */
export function formatReport(violations: Violation[]): string {
  const lines = ['error: merge-conflict markers found in staged/changed content:'];
  for (const { path, lineno, line } of violations) {
    lines.push(`  ${path}:${lineno}: ${line}`);
  }
  lines.push(
    '\nResolve the conflict, or bypass intentionally with ' +
      '`git commit --no-verify` (or ALLOW_CONFLICT_MARKERS=1).',
  );
  return lines.join('\n');
}
