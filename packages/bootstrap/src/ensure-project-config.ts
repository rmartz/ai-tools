import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  goldenIgnoreFiles,
  BLOCK_BEGIN,
  BLOCK_END,
  type GoldenIgnoreFile,
  type GoldenWorkflowFile,
} from './golden-config.js';
import { ensureWorkflowFiles } from './ensure-workflow-files.js';

export { BLOCK_BEGIN, BLOCK_END } from './golden-config.js';

/**
 * Idempotently apply golden-state config to a repository — two categories, two
 * mechanisms. TS-toolchain reframe of dotfiles' `ensure_project_config.py`.
 *
 * 1. **Ignore files** (`.prettierignore`, `.eslintignore`, `.gitignore`) get one
 *    fenced "managed" block (BLOCK_BEGIN…BLOCK_END): we rewrite only that block's
 *    contents and preserve any user-authored lines outside it — "ensure block
 *    present, don't clobber user content".
 * 2. **Whole workflow files** (`.github/workflows/*.yml`) are managed as whole
 *    files (write-if-absent / overwrite-if-drifted), delegated to
 *    `ensure-workflow-files.ts`.
 *
 * Pure fs — no subprocess, no network. The target directory is a parameter so
 * tests can point at a tmpdir.
 */

export type ConfigAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'withheld';

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
  /** Override the golden ignore-file set (tests). Defaults to `goldenIgnoreFiles`. */
  files?: readonly GoldenIgnoreFile[];
  /** Override the golden workflow-file set (tests). Defaults to `goldenWorkflowFiles`. */
  workflows?: readonly GoldenWorkflowFile[];
  /**
   * Gate checks known satisfied on the repo. Passed through to
   * {@link ensureWorkflowFiles}: a gated workflow (e.g. the auto-merge workflow)
   * is **withheld** unless its `gateChecks` are all present. Defaults to `[]`, so
   * a direct call never lands the auto-merge workflow ungated (#239).
   */
  satisfiedGateChecks?: readonly string[];
}

/**
 * Ensure every golden ignore file's managed block and every golden workflow file
 * under `root` are present and current. Pure fs — no subprocess, no network.
 * Returns a combined per-file outcome list (ignore files first, then workflows).
 */
export function ensureProjectConfig(
  root: string,
  opts: EnsureProjectConfigOptions = {},
): EnsureProjectConfigResult {
  const files = opts.files ?? goldenIgnoreFiles;
  const ignoreOutcomes = files.map((file) => ensureFile(root, file));
  const workflowOutcomes = ensureWorkflowFiles(root, {
    workflows: opts.workflows,
    satisfiedGateChecks: opts.satisfiedGateChecks,
  });
  return { root, outcomes: [...ignoreOutcomes, ...workflowOutcomes] };
}
