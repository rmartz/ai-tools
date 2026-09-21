import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { goldenWorkflowFiles, type GoldenWorkflowFile } from './golden-config.js';

/**
 * Whole-file half of `ensure-project-config`, for GitHub Actions workflow files that
 * are identical across every repo. Distinct from the block-splice strategy in
 * `ensure-project-config.ts`: a workflow is not user content with a managed region
 * inside it, it *is* the whole artifact — so the semantics are **write-if-absent**
 * and nothing more. Bootstrap seeds a new repo once and the repo owns the file
 * thereafter; an existing file is never overwritten, whoever authored it. Keeping an
 * *existing* repo's workflows current is the repository checklist's job (audit +
 * self-manage), not bootstrap's — bootstrap is a new-repo initializer, not an
 * ongoing manager.
 *
 * Like its sibling, this is pure fs — no subprocess, no network. It stays hermetic
 * even while enforcing the auto-merge gate: it does not *check* the gate (that
 * network read lives in `verify-automerge-gate.ts` / `gate-satisfaction.ts`) — it
 * receives the already-resolved `satisfiedGateChecks` set as data and **withholds**
 * the creation of a workflow whose declared `gateChecks` are not in it. This closes
 * the hazard that a `gh pr merge --auto` workflow seeded with no required checks
 * auto-merges every green bump immediately (#239): the default
 * (`satisfiedGateChecks: []`) withholds the gated auto-merge workflow, so even a
 * direct writer call never lands it ungated.
 */

export type WorkflowAction = 'created' | 'unchanged' | 'withheld';

export interface WorkflowOutcome {
  filename: string;
  action: WorkflowAction;
}

/** True when every gate check a workflow declares is in the satisfied set. */
function gateSatisfied(file: GoldenWorkflowFile, satisfiedGateChecks: readonly string[]): boolean {
  return file.gateChecks.every((c) => satisfiedGateChecks.includes(c));
}

/** Seed one golden file: write it if absent (gate permitting), else leave it be. */
function ensureWorkflowFile(
  root: string,
  file: GoldenWorkflowFile,
  satisfiedGateChecks: readonly string[],
): WorkflowOutcome {
  const path = join(root, file.filename);

  // An existing file is the repo's own — never overwritten.
  if (existsSync(path)) return { filename: file.filename, action: 'unchanged' };

  // Withhold *creating* a gated workflow whose gate is not satisfied — never seed an
  // ungated auto-merge workflow (#239).
  if (!gateSatisfied(file, satisfiedGateChecks)) {
    return { filename: file.filename, action: 'withheld' };
  }

  mkdirSync(dirname(path), { recursive: true });
  const body = file.content.endsWith('\n') ? file.content : `${file.content}\n`;
  writeFileSync(path, body, 'utf8');
  return { filename: file.filename, action: 'created' };
}

export interface EnsureWorkflowFilesOptions {
  /** Override the golden workflow set (tests). Defaults to `goldenWorkflowFiles`. */
  workflows?: readonly GoldenWorkflowFile[];
  /**
   * Gate checks known to be satisfied on the target repo. A golden workflow whose
   * `gateChecks` are not all present here is **withheld** (not created), so a gated
   * auto-merge workflow never lands before its gate. Defaults to `[]` — the safe
   * direction: absent proof of the gate, the gated workflow is withheld.
   */
  satisfiedGateChecks?: readonly string[];
}

/**
 * Seed every golden workflow file under `root` that is not already present. Returns
 * a per-file outcome list; `withheld` marks a gated workflow not created because its
 * gate is not in `satisfiedGateChecks`, `unchanged` a file the repo already owns.
 */
export function ensureWorkflowFiles(
  root: string,
  opts: EnsureWorkflowFilesOptions = {},
): WorkflowOutcome[] {
  const workflows = opts.workflows ?? goldenWorkflowFiles;
  const satisfied = opts.satisfiedGateChecks ?? [];
  return workflows.map((file) => ensureWorkflowFile(root, file, satisfied));
}
