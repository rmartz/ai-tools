/**
 * Extract the locally-runnable check subset from a project's CI workflows.
 *
 * Reads `.github/workflows/*.yml`, walks every `jobs[].steps[].run` block,
 * splits multi-line blocks into individual command segments, and classifies
 * each via `classifyCommand` from `@rmartz/agent-runtime`. The result is the
 * deduplicated, category-ordered set of checks the pre-push gate re-runs.
 *
 * Splitting half of dotfiles' `pre_push_verify.py`; the running half lives in
 * `pre-push-verify.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { CATEGORY_ORDER, classifyCommand } from '@rmartz/agent-runtime';
import type { Check } from '@rmartz/agent-runtime';

/** Injectable filesystem boundary so extraction is testable from in-memory YAML. */
export interface WorkflowFs {
  readdir: (dir: string) => string[];
  readFile: (path: string) => string;
}

const realFs: WorkflowFs = {
  readdir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync(path, 'utf8'),
};

/**
 * Split a (possibly multi-line) run block into individual command segments,
 * joining backslash continuations and splitting on newlines and `&&` so an
 * `install && check` step yields the check separately. Blank and comment lines
 * are dropped.
 */
export function splitCommands(run: string): string[] {
  const text = run.replace(/\\\n/g, ' ');
  const segments: string[] = [];
  for (const line of text.split('\n')) {
    for (const piece of line.split('&&')) {
      const segment = piece.trim();
      if (segment && !segment.startsWith('#')) segments.push(segment);
    }
  }
  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Yield every `run:` command segment across a single parsed workflow document. */
function* runCommandsOf(doc: unknown): Generator<string> {
  if (!isRecord(doc)) return;
  const jobs = doc.jobs;
  if (!isRecord(jobs)) return;
  for (const job of Object.values(jobs)) {
    if (!isRecord(job)) continue;
    const steps = job.steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (!isRecord(step)) continue;
      const run = step.run;
      if (typeof run === 'string') yield* splitCommands(run);
    }
  }
}

/** Yield every `run:` command segment across all workflow files under the repo. */
export function* iterRunCommands(repoRoot: string, fs: WorkflowFs = realFs): Generator<string> {
  const workflows = join(repoRoot, '.github', 'workflows');
  let entries: string[];
  try {
    entries = [...fs.readdir(workflows)].sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    let doc: unknown;
    try {
      doc = parse(fs.readFile(join(workflows, entry)));
    } catch {
      continue;
    }
    yield* runCommandsOf(doc);
  }
}

/** Return the deduplicated, category-ordered set of locally-runnable checks. */
export function selectChecks(repoRoot: string, fs: WorkflowFs = realFs): Check[] {
  const seen = new Set<string>();
  const checks: Check[] = [];
  for (const command of iterRunCommands(repoRoot, fs)) {
    const check = classifyCommand(command);
    if (check === null) continue;
    // Dedup on the whitespace-normalized command so two formattings of the same
    // command collapse to one check.
    const key = check.command.split(/\s+/).filter(Boolean).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push(check);
  }
  checks.sort((a, b) => {
    const order = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return order !== 0 ? order : a.command.localeCompare(b.command);
  });
  return checks;
}
