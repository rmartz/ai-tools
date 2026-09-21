import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  goldenIgnoreFiles,
  retiredIgnoreFiles,
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
 * 1. **Ignore files** (`.prettierignore`, `.gitignore`) get one fenced "managed"
 *    block (BLOCK_BEGIN…BLOCK_END): we rewrite only that block's contents and
 *    preserve any user-authored lines outside it — "ensure block present, don't
 *    clobber user content". A **retired** ignore file (`.eslintignore`, #253) runs
 *    the inverse: strip our block, and delete the file if it held only that block.
 * 2. **Whole workflow files** (`.github/workflows/*.yml`) are seeded as whole files
 *    (write-if-absent, then repo-owned), delegated to `ensure-workflow-files.ts`.
 *    Bootstrap seeds a new repo once; an existing workflow is never overwritten, and
 *    sweeping a stale/retired workflow from an existing repo is the repository
 *    checklist's job (audit), not bootstrap's.
 *
 * Pure fs — no subprocess, no network. The target directory is a parameter so
 * tests can point at a tmpdir.
 */

export type ConfigAction = 'created' | 'updated' | 'unchanged' | 'withheld' | 'removed';

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

/**
 * Remove our managed block from `text` (the inverse of {@link spliceBlock}),
 * preserving lines outside it. Returns `text` unchanged when no block is present.
 */
function stripBlock(text: string): string {
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin === -1) return text;
  const endMarker = text.indexOf(BLOCK_END, begin);
  const endOfBlock = endMarker === -1 ? text.length : endMarker + BLOCK_END.length;
  return `${text.slice(0, begin)}${text.slice(endOfBlock).replace(/^\n/, '')}`;
}

/**
 * Retire a formerly-seeded ignore file: strip our managed block, delete the file
 * if that block was all it held, and never touch a file we didn't manage (one with
 * no block). Absent file → `unchanged`.
 */
function retireFile(root: string, filename: string): ConfigOutcome {
  const path = join(root, filename);
  if (!existsSync(path)) return { filename, action: 'unchanged' };
  const current = readFileSync(path, 'utf8');
  const stripped = stripBlock(current);
  if (stripped === current) return { filename, action: 'unchanged' };
  if (stripped.trim() === '') {
    rmSync(path);
    return { filename, action: 'removed' };
  }
  writeFileSync(path, stripped, 'utf8');
  return { filename, action: 'updated' };
}

export interface EnsureProjectConfigOptions {
  /** Override the golden ignore-file set (tests). Defaults to `goldenIgnoreFiles`. */
  files?: readonly GoldenIgnoreFile[];
  /** Override the retired ignore-file set (tests). Defaults to `retiredIgnoreFiles`. */
  retired?: readonly string[];
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
 * Ensure every golden ignore file's managed block is present and current, retire any
 * formerly-seeded ignore file, and seed every golden workflow file under `root` that
 * is not already present. Pure fs — no subprocess, no network. Returns a combined
 * per-file outcome list (golden ignore files, retired ignore files, then golden
 * workflows).
 */
export function ensureProjectConfig(
  root: string,
  opts: EnsureProjectConfigOptions = {},
): EnsureProjectConfigResult {
  const files = opts.files ?? goldenIgnoreFiles;
  const retired = opts.retired ?? retiredIgnoreFiles;
  const ignoreOutcomes = files.map((file) => ensureFile(root, file));
  const retiredOutcomes = retired.map((filename) => retireFile(root, filename));
  const workflowOutcomes = ensureWorkflowFiles(root, {
    workflows: opts.workflows,
    satisfiedGateChecks: opts.satisfiedGateChecks,
  });
  return {
    root,
    outcomes: [...ignoreOutcomes, ...retiredOutcomes, ...workflowOutcomes],
  };
}
