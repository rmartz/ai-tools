import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  goldenIgnoreFiles,
  BLOCK_BEGIN,
  BLOCK_END,
  type GoldenIgnoreFile,
} from './golden-config.js';

export { BLOCK_BEGIN, BLOCK_END } from './golden-config.js';

/**
 * Idempotently apply golden-state tooling ignores to a repository. TS-toolchain
 * reframe of dotfiles' `ensure_project_config.py`: instead of splicing a single
 * entry into a JS ESLint config, this manages line-based ignore files
 * (`.prettierignore`, `.eslintignore`, `.gitignore`) for a pnpm/TS monorepo.
 *
 * Each file gets one fenced "managed" block (BLOCK_BEGIN…BLOCK_END). We rewrite
 * only that block's contents; any user-authored lines outside it are preserved
 * verbatim — "ensure block present, don't clobber user content". The target
 * directory is a parameter so tests can point at a tmpdir.
 */

export type ConfigAction = 'created' | 'updated' | 'unchanged';

export interface ConfigOutcome {
  filename: string;
  action: ConfigAction;
}

export interface EnsureProjectConfigResult {
  /** Resolved repository root the files were written under. */
  root: string;
  outcomes: ConfigOutcome[];
}

/** Render the fenced managed block for the given entries. */
function renderBlock(entries: string[]): string {
  return [BLOCK_BEGIN, ...entries, BLOCK_END].join('\n');
}

/**
 * Replace the existing managed block in `text` with `block`, or append it. The
 * region is matched from BLOCK_BEGIN through BLOCK_END inclusive; lines outside
 * it are left untouched. Returns the new file text.
 */
function spliceBlock(text: string, block: string): string {
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin === -1) {
    const prefix = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`;
    const sep = prefix.length === 0 ? '' : '\n';
    return `${prefix}${sep}${block}\n`;
  }
  const endMarker = text.indexOf(BLOCK_END, begin);
  // A truncated block (BEGIN with no END) is replaced from BEGIN to end-of-file.
  const endOfBlock = endMarker === -1 ? text.length : endMarker + BLOCK_END.length;
  const before = text.slice(0, begin);
  const after = text.slice(endOfBlock).replace(/^\n/, '');
  const tail = after.length > 0 ? `\n${after}` : '\n';
  return `${before}${block}${tail}`;
}

/** Ensure one golden ignore file's managed block is present and current. */
function ensureFile(root: string, file: GoldenIgnoreFile): ConfigOutcome {
  const path = join(root, file.filename);
  const existed = existsSync(path);
  const current = existed ? readFileSync(path, 'utf8') : '';
  const next = spliceBlock(current, renderBlock(file.entries));
  if (next === current) return { filename: file.filename, action: 'unchanged' };
  writeFileSync(path, next, 'utf8');
  return { filename: file.filename, action: existed ? 'updated' : 'created' };
}

export interface EnsureProjectConfigOptions {
  /** Override the golden file set (tests). Defaults to `goldenIgnoreFiles`. */
  files?: readonly GoldenIgnoreFile[];
}

/**
 * Ensure every golden ignore file under `root` carries its managed block. Pure
 * fs — no subprocess, no network. Returns a per-file outcome list.
 */
export function ensureProjectConfig(
  root: string,
  opts: EnsureProjectConfigOptions = {},
): EnsureProjectConfigResult {
  const files = opts.files ?? goldenIgnoreFiles;
  const outcomes = files.map((file) => ensureFile(root, file));
  return { root, outcomes };
}
