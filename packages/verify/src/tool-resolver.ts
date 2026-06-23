/**
 * Resolve a project tool binary to an executable argv prefix.
 *
 * A **reframe** of dotfiles' `python_env.py`, not a port. The Python resolved a
 * venv-first Python interpreter (≥3.10) because the pinned formatters/linters
 * were Python tools installed in a per-worktree `.venv`. This monorepo's CI
 * tools (prettier, eslint, tsc, vitest) are Node packages installed under the
 * project's `node_modules/.bin`, so the equivalent concern here is: "which copy
 * of the tool does the project actually run?" — the locally-installed one, the
 * same binary CI uses, rather than whatever stray global happens to be on PATH.
 *
 * Resolution order, from a repo root:
 *   1. `node_modules/.bin/<tool>` — the project's own pinned binary (exact
 *      version, matches CI byte-for-byte). Preferred whenever present.
 *   2. A bare PATH lookup of the tool, run as written.
 *   3. `pnpm exec <tool>` — only when neither the local bin nor PATH has the
 *      tool but a `pnpm` launcher is available, so a project that runs its tools
 *      exclusively through pnpm still resolves.
 *
 * Returns `null` when nothing usable is found, so callers can distinguish "tool
 * unavailable" (a skip) from "tool failed" — mirroring the Python's soft-fail.
 */

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Conventional local bin directory, relative to a repo root. */
export const LOCAL_BIN_DIR = join('node_modules', '.bin');

/** Injectable filesystem/PATH boundaries so resolution is testable without disk. */
export interface ResolveToolOptions {
  /** Existence predicate (default: `node:fs.existsSync`). */
  exists?: (path: string) => boolean;
  /** Raw PATH string to scan (default: `process.env.PATH`). */
  path?: string;
  /** PATH entry separator (default: platform `node:path.delimiter`). */
  pathDelimiter?: string;
}

/** Path to a tool inside the repo's `node_modules/.bin`, if present. */
export function localBin(
  repoRoot: string,
  tool: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const candidate = join(repoRoot, LOCAL_BIN_DIR, tool);
  return exists(candidate) ? candidate : null;
}

/** First PATH directory containing `tool` as an executable file, or `null`. */
export function onPath(tool: string, opts: ResolveToolOptions = {}): string | null {
  const exists = opts.exists ?? existsSync;
  const raw = opts.path ?? process.env.PATH ?? '';
  const sep = opts.pathDelimiter ?? delimiter;
  for (const dir of raw.split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, tool);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Return the argv prefix to run a project tool, or `null` if unavailable.
 *
 * Prefers the project's `node_modules/.bin/<tool>`, then a PATH lookup, then a
 * `pnpm exec <tool>` launcher. The returned array is an argv prefix — append the
 * tool's own arguments to it before running.
 */
export function resolveTool(
  repoRoot: string,
  tool: string,
  opts: ResolveToolOptions = {},
): string[] | null {
  const local = localBin(repoRoot, tool, opts.exists ?? existsSync);
  if (local !== null) return [local];

  const fromPath = onPath(tool, opts);
  if (fromPath !== null) return [fromPath];

  // Last resort: a project that drives its tools only through pnpm. Resolve the
  // launcher itself on PATH so we never emit an argv for a missing `pnpm`.
  if (onPath('pnpm', opts) !== null) return ['pnpm', 'exec', tool];

  return null;
}
