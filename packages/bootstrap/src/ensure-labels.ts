import {
  listLabels,
  createLabel,
  updateLabel,
  type Label,
  type GhCallOptions,
} from '@rmartz/github';
import { defaultRoster, type LabelSpec } from './labels-roster.js';

/**
 * Idempotently reconcile a repository's labels with the canonical roster: list
 * current labels, diff each spec against live state, and create / update /
 * rename-in-place to match. TS port of dotfiles' `label_ops.install_labels`
 * (+ `ensure_labels.py` entrypoint), retargeted at the `@rmartz/github` client.
 *
 * Soft-fail mirrors the Python's best-effort posture: a failed list aborts (we
 * cannot diff without live state), but per-label failures are collected and
 * surfaced in the result rather than thrown — every label is attempted.
 */

/** What happened to one label during reconciliation. */
export type LabelOutcome =
  | { name: string; action: 'unchanged' }
  | { name: string; action: 'created' }
  | { name: string; action: 'updated' }
  | { name: string; action: 'renamed'; from: string }
  | { name: string; action: 'failed'; error: string };

export interface EnsureLabelsResult {
  /** Resolved `owner/repo` the labels were applied to. */
  repo: string;
  outcomes: LabelOutcome[];
  /** Names that failed — empty on full success. */
  failures: string[];
}

export interface EnsureLabelsOptions {
  /** Extra labels to reconcile on top of the default roster. */
  extra?: readonly LabelSpec[];
  /** Reconcile exactly this set instead of the default roster (tests / overrides). */
  roster?: readonly LabelSpec[];
  /** Passed through to every `@rmartz/github` call (cwd / sleep). */
  call?: GhCallOptions;
}

/** Normalize a color for drift comparison: drop a leading `#`, lowercase. */
function normColor(color: string): string {
  return (color || '').replace(/^#/, '').toLowerCase();
}

/** True when the live label already matches the spec's color + description. */
function matches(current: Label, spec: LabelSpec): boolean {
  return (
    normColor(current.color) === normColor(spec.color) &&
    (current.description ?? '') === (spec.description ?? '')
  );
}

/** Build a case-insensitive name → live-label lookup. */
function indexByName(labels: Label[]): Map<string, Label> {
  const m = new Map<string, Label>();
  for (const lbl of labels) m.set(lbl.name.toLowerCase(), lbl);
  return m;
}

/** Live name of the first `renamedFrom` entry still present, or `null`. */
function findFormerName(spec: LabelSpec, existing: Map<string, Label>): string | null {
  for (const former of spec.renamedFrom ?? []) {
    if (!former) continue;
    const hit = existing.get(former.toLowerCase());
    if (hit) return hit.name;
  }
  return null;
}

/**
 * Create, update, or rename one label. Returns its outcome; on `gh` failure the
 * outcome is `{ action: 'failed' }` (the caller aggregates) rather than throwing.
 */
async function applyLabel(
  repo: string,
  spec: LabelSpec,
  existing: Map<string, Label>,
  call: GhCallOptions,
): Promise<LabelOutcome> {
  const current = existing.get(spec.name.toLowerCase());

  if (current) {
    if (current.name !== spec.name) {
      const out = await updateLabel(
        repo,
        current.name,
        spec.color,
        spec.description,
        { newName: spec.name },
        call,
      );
      return out === null
        ? { name: spec.name, action: 'failed', error: `rename ${current.name} -> ${spec.name}` }
        : { name: spec.name, action: 'renamed', from: current.name };
    }
    if (matches(current, spec)) return { name: spec.name, action: 'unchanged' };
    const out = await updateLabel(repo, spec.name, spec.color, spec.description, {}, call);
    return out === null
      ? { name: spec.name, action: 'failed', error: `update ${spec.name}` }
      : { name: spec.name, action: 'updated' };
  }

  const former = findFormerName(spec, existing);
  if (former !== null) {
    const out = await updateLabel(
      repo,
      former,
      spec.color,
      spec.description,
      { newName: spec.name },
      call,
    );
    return out === null
      ? { name: spec.name, action: 'failed', error: `rename ${former} -> ${spec.name}` }
      : { name: spec.name, action: 'renamed', from: former };
  }

  const out = await createLabel(repo, spec.name, spec.color, spec.description, call);
  return out === null
    ? { name: spec.name, action: 'failed', error: `create ${spec.name}` }
    : { name: spec.name, action: 'created' };
}

/**
 * Reconcile `repo`'s labels with `roster` (default: cross-cutting + meta), plus
 * any `extra`. Lists current labels once, then applies each spec idempotently.
 * Throws only when the initial list fails (no live state to diff against);
 * per-label failures are reported in `result.failures`.
 */
export async function ensureLabels(
  repo: string,
  opts: EnsureLabelsOptions = {},
): Promise<EnsureLabelsResult> {
  const roster = opts.roster ?? [...defaultRoster, ...(opts.extra ?? [])];
  const call = opts.call ?? {};

  const current = await listLabels(repo, call);
  if (current === null) {
    throw new Error(`failed to list labels on ${repo}`);
  }
  const existing = indexByName(current);

  const outcomes: LabelOutcome[] = [];
  const failures: string[] = [];
  for (const spec of roster) {
    const outcome = await applyLabel(repo, spec, existing, call);
    outcomes.push(outcome);
    if (outcome.action === 'failed') failures.push(outcome.name);
    else existing.set(spec.name.toLowerCase(), { ...spec, description: spec.description });
  }

  return { repo, outcomes, failures };
}
