import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { boundedRun } from '@rmartz/agent-runtime';

/**
 * Shared file discovery for repo-hygiene checks. Every check runs over one of
 * three git-derived file sets, selected by {@link Mode}; resolving the set (and
 * the reader that goes with it) once and handing it to each check is what lets a
 * consumer run one job per check or a single aggregate job over the same inputs.
 *
 * Tracked-only discovery (`git ls-files`, `git diff`) gives ignore-handling for
 * free — an untracked or `.gitignore`d file is never in scope.
 */

const GIT_TIMEOUT_MS = 30_000;

/** How a path's content is resolved for scanning. */
export type ContentReader = (path: string) => Promise<string> | string;

export interface ScanOptions {
  cwd?: string;
}

/**
 * The three run modes, mirroring the standalone conflict-marker checker:
 * `--staged` scans staged blobs (the `pre-commit` hook), `--check` scans all
 * tracked files (the CI backstop), `--check-diff` scans files changed vs
 * `origin/main`.
 */
export type Mode = '--staged' | '--check' | '--check-diff';

/** A resolved set of in-scope paths plus the reader appropriate to the mode. */
export interface FileSet {
  paths: string[];
  read: ContentReader;
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
  const { stdout, code } = await runGit(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    opts.cwd,
  );
  if (code !== 0) throw new Error(`git diff --cached failed with code ${code}`);
  return splitNul(stdout);
}

/** All git-tracked files (NUL-delimited). */
export async function trackedFiles(opts: ScanOptions = {}): Promise<string[]> {
  const { stdout, code } = await runGit(['ls-files', '-z'], opts.cwd);
  if (code !== 0) throw new Error(`git ls-files failed with code ${code}`);
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
export function worktreeContent(path: string, opts: ScanOptions = {}): string {
  const fullPath = opts.cwd != null && !isAbsolute(path) ? join(opts.cwd, path) : path;
  try {
    return readFileSync(fullPath, 'utf8');
  } catch {
    return ''; // missing or binary — no text markers to find
  }
}

/** Resolve the path list and per-path reader for a mode. */
export async function resolveFileSet(mode: Mode, opts: ScanOptions = {}): Promise<FileSet> {
  if (mode === '--staged') {
    return { paths: await stagedFiles(opts), read: (p) => stagedContent(p, opts) };
  }
  if (mode === '--check') {
    return { paths: await trackedFiles(opts), read: (p) => worktreeContent(p, opts) };
  }
  return { paths: await changedVsMain(opts), read: (p) => worktreeContent(p, opts) };
}
