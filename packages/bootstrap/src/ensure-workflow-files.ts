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
 * Like its sibling, this is pure fs — no subprocess, no network. It stays
 * hermetic even while enforcing the auto-merge gate: it does not *check* the gate
 * (that network read lives in `verify-automerge-gate.ts` / `gate-satisfaction.ts`)
 * — it receives the already-resolved `satisfiedGateChecks` set as data and
 * **withholds** the creation of a workflow whose declared `gateChecks` are not in
 * it. This closes the hazard that a `gh pr merge --auto` workflow seeded with no
 * required checks auto-merges every green bump immediately (#239): the default
 * (`satisfiedGateChecks: []`) withholds the gated auto-merge workflow, so even a
 * direct writer call never lands it ungated. Withholding blocks **creation only**
 * — an existing file is managed normally, since an empty set may just mean "the
 * caller did not check the gate", and deleting on that would be wrong.
 */

export type WorkflowAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'withheld';

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

/** True when every gate check a workflow declares is in the satisfied set. */
function gateSatisfied(file: GoldenWorkflowFile, satisfiedGateChecks: readonly string[]): boolean {
  return file.gateChecks.every((c) => satisfiedGateChecks.includes(c));
}

/** Ensure one golden file is present and current, per its {@link GoldenWorkflowFile.policy}. */
function ensureWorkflowFile(
  root: string,
  file: GoldenWorkflowFile,
  satisfiedGateChecks: readonly string[],
): WorkflowOutcome {
  const path = join(root, file.filename);

  // Withhold *creating* a gated workflow whose gate is not satisfied — never seed
  // an ungated auto-merge workflow (#239). Creation only: an existing file is left
  // to the normal management path below, since `[]` may mean "gate not checked".
  if (!existsSync(path) && !gateSatisfied(file, satisfiedGateChecks)) {
    return { filename: file.filename, action: 'withheld' };
  }

  // `seed`: write the plain content once (no managed header — the repo owns it
  // thereafter) and never touch it again once present, whoever authored it.
  if ((file.policy ?? 'manage') === 'seed') {
    if (existsSync(path)) return { filename: file.filename, action: 'unchanged' };
    mkdirSync(dirname(path), { recursive: true });
    const body = file.content.endsWith('\n') ? file.content : `${file.content}\n`;
    writeFileSync(path, body, 'utf8');
    return { filename: file.filename, action: 'created' };
  }

  // `manage` (default): bootstrap owns the file — write if absent, overwrite if a
  // previously-managed file has drifted, and leave a user-authored file untouched.
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
  /**
   * Gate checks known to be satisfied on the target repo. A golden workflow whose
   * `gateChecks` are not all present here is **withheld** (not created), so a
   * gated auto-merge workflow never lands before its gate. Defaults to `[]` — the
   * safe direction: absent proof of the gate, the gated workflow is withheld.
   */
  satisfiedGateChecks?: readonly string[];
}

/**
 * Ensure every golden workflow file under `root` is written and current. Returns a
 * per-file outcome list; `skipped` marks a path where a user-authored file already
 * lives (no managed header), which we never overwrite; `withheld` marks a gated
 * workflow not created because its gate is not in `satisfiedGateChecks`.
 */
export function ensureWorkflowFiles(
  root: string,
  opts: EnsureWorkflowFilesOptions = {},
): WorkflowOutcome[] {
  const workflows = opts.workflows ?? goldenWorkflowFiles;
  const satisfied = opts.satisfiedGateChecks ?? [];
  return workflows.map((file) => ensureWorkflowFile(root, file, satisfied));
}
