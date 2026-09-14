import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  goldenWorkflowFiles,
  WORKFLOW_MANAGED_HEADER,
  WORKFLOW_MANAGED_MARKER,
  type GoldenWorkflowFile,
} from './golden-config.js';

/**
 * Whole managed-file half of `ensure-project-config`, for GitHub Actions workflow
 * files that are identical across every repo. Distinct from the block-splice
 * strategy in `ensure-project-config.ts`: a workflow is not user content with a
 * managed region inside it, it *is* the managed artifact — so the semantics are
 * write-if-absent / overwrite-if-drifted, guarded by a managed header so a
 * user-authored file at the same path is never clobbered.
 *
 * Like its sibling, this is pure fs — no subprocess, no network. The gate the
 * seeded workflow depends on is confirmed by a separate, network-touching command
 * (`verify-automerge-gate.ts`); it is deliberately not bolted in here.
 */

export type WorkflowAction = 'created' | 'updated' | 'unchanged' | 'skipped';

export interface WorkflowOutcome {
  filename: string;
  action: WorkflowAction;
}

/** Full golden text of a managed workflow file: the managed header plus its body. */
export function renderManagedWorkflow(file: GoldenWorkflowFile): string {
  const body = file.content.endsWith('\n') ? file.content : `${file.content}\n`;
  return `${WORKFLOW_MANAGED_HEADER}\n\n${body}`;
}

/** A file we previously wrote carries the managed marker; anything else is user-authored. */
function isBootstrapManaged(text: string): boolean {
  return text.includes(WORKFLOW_MANAGED_MARKER);
}

/** Ensure one golden workflow file is present and current, without clobbering user content. */
function ensureWorkflowFile(root: string, file: GoldenWorkflowFile): WorkflowOutcome {
  const path = join(root, file.filename);
  const golden = renderManagedWorkflow(file);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, golden, 'utf8');
    return { filename: file.filename, action: 'created' };
  }
  const current = readFileSync(path, 'utf8');
  // A file without our header is user-authored — leave it untouched, don't overwrite.
  if (!isBootstrapManaged(current)) return { filename: file.filename, action: 'skipped' };
  if (current === golden) return { filename: file.filename, action: 'unchanged' };
  writeFileSync(path, golden, 'utf8');
  return { filename: file.filename, action: 'updated' };
}

export interface EnsureWorkflowFilesOptions {
  /** Override the golden workflow set (tests). Defaults to `goldenWorkflowFiles`. */
  workflows?: readonly GoldenWorkflowFile[];
}

/**
 * Ensure every golden workflow file under `root` is written and current. Returns a
 * per-file outcome list; `skipped` marks a path where a user-authored file already
 * lives (no managed header), which we never overwrite.
 */
export function ensureWorkflowFiles(
  root: string,
  opts: EnsureWorkflowFilesOptions = {},
): WorkflowOutcome[] {
  const workflows = opts.workflows ?? goldenWorkflowFiles;
  return workflows.map((file) => ensureWorkflowFile(root, file));
}
