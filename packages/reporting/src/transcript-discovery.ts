import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Discover Claude Code transcript `*.jsonl` files modified within a recent time
 * window. This is the discovery layer the friction extractor deliberately lacks:
 * `friction.ts` stays a pure text-in / events-out serializer with no `~/.claude`
 * directory-walking knowledge, and this module carries that filesystem concern so
 * the `ai-extract-friction` CLI can self-discover the last-N-days transcripts.
 *
 * All filesystem access routes through one injectable {@link TranscriptFs} so
 * tests are hermetic — they feed an in-memory listing with controlled mtimes and
 * never touch the real disk (mirroring the `GhReader` pattern in
 * `efficiency-derive.ts`). The default reader uses `node:fs`.
 */

const DEFAULT_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/** The real-world filesystem boundary, injected so the core stays hermetic. */
export interface TranscriptFs {
  /** Absolute paths of every `*.jsonl` under `root`, recursively. */
  listJsonl(root: string): string[];
  /** Modification time in epoch-ms for a path. */
  mtimeMs(path: string): number;
}

export interface DiscoverTranscriptsOptions {
  /** Root to walk. Default: `~/.claude/projects`. */
  root?: string;
  /** Window size in days. Default: {@link DEFAULT_DAYS} (7). */
  days?: number;
  /** "Now" in epoch-ms. Default: `Date.now()` — injected in tests. */
  now?: number;
  /** Filesystem boundary. Default: {@link realTranscriptFs} over `node:fs`. */
  fs?: TranscriptFs;
}

/** Recursively collect absolute `*.jsonl` paths under `root`; `[]` on any error. */
function listJsonlReal(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => join(root, entry));
  } catch {
    return [];
  }
}

/** The default `node:fs`-backed reader. Missing/unreadable paths soft-fail. */
export const realTranscriptFs: TranscriptFs = {
  listJsonl: listJsonlReal,
  mtimeMs(path) {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  },
};

/**
 * Absolute paths of transcript `*.jsonl` files modified within the last `days`.
 *
 * The window is **inclusive** at its lower edge: a file whose `mtimeMs` is
 * exactly `now - days * 86_400_000` is kept. Results are sorted **most-recent
 * first** (descending `mtimeMs`), ties broken by lexical path for stability.
 */
export function discoverTranscripts(opts: DiscoverTranscriptsOptions = {}): string[] {
  const root = opts.root ?? join(homedir(), '.claude', 'projects');
  const days = opts.days ?? DEFAULT_DAYS;
  const now = opts.now ?? Date.now();
  const fs = opts.fs ?? realTranscriptFs;

  const cutoff = now - days * MS_PER_DAY;
  return fs
    .listJsonl(root)
    .map((path) => ({ path, mtimeMs: fs.mtimeMs(path) }))
    .filter((entry) => entry.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .map((entry) => entry.path);
}
