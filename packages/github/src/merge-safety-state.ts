import type { GhCallOptions } from './gh-call.js';
import { prState, readJson, type PrState, type RawPull } from './dependabot-state.js';

/**
 * Read the `merge-safety` verdict posted on a PR's **current head commit**.
 *
 * merge-safety (rmartz/merge-safety, `docs/check-run-contract.md`) posts its
 * verdict under the name `merge-safety` twice: as a commit status and as a
 * check-run, both carrying the same state and title. The commit status is what
 * the merge gate relies on (a check-run can sit in a superseded check suite the
 * gate ignores), so it is read first; the check-run is the fallback for a consumer
 * whose workflow lacks `statuses: write`.
 *
 * Both reads are keyed by the head SHA, so a verdict left on an older head (for
 * example the `Update required` that preceded a rebase) never counts for the new
 * one. Labels are never read: the `update required` label lags the verdict.
 */

export const MERGE_SAFETY_CHECK_NAME = 'merge-safety';

/** The verdict normalised across the commit status and the check-run. */
export type MergeSafetyState = 'success' | 'failure' | 'pending';

export interface MergeSafetyReport {
  source: 'status' | 'check-run';
  state: MergeSafetyState;
  /** The check-run title / commit-status description, e.g. `Update required`. */
  title: string;
}

export interface MergeSafetySnapshot {
  state: PrState;
  headSha: string;
  /** The verdict on `headSha`, or `null` when nothing is posted on it yet. */
  report: MergeSafetyReport | null;
}

interface RawHeadPull extends RawPull {
  head: { sha: string };
}

interface RawStatus {
  context: string;
  state: string;
  description: string | null;
}

interface RawCheckRun {
  id: number;
  status: string;
  conclusion: string | null;
  output: { title: string | null } | null;
}

/** Commit-status states: `success`, `pending`, `failure` and `error`. */
function statusState(state: string): MergeSafetyState {
  if (state === 'success') return 'success';
  if (state === 'pending') return 'pending';
  return 'failure';
}

/**
 * An incomplete run is `pending` (its title says whether a verdict is coming).
 * GitHub marks a run left incomplete for 14 days `stale`, which keeps it pending.
 * GitHub merges a required check only on `success`, `neutral` or `skipped`.
 */
function checkRunState(run: RawCheckRun): MergeSafetyState {
  if (run.status !== 'completed' || run.conclusion === 'stale') return 'pending';
  return ['success', 'neutral', 'skipped'].includes(run.conclusion ?? '') ? 'success' : 'failure';
}

/** The latest `merge-safety` commit status on `sha`, or `undefined` / `null` (failed read). */
async function readStatusReport(
  repo: string,
  sha: string,
  call: GhCallOptions,
): Promise<MergeSafetyReport | undefined | null> {
  // The combined-status endpoint returns only the latest status per context.
  const combined = await readJson<{ statuses: RawStatus[] }>(
    `repos/${repo}/commits/${sha}/status?per_page=100`,
    false,
    call,
  );
  if (combined === null) return null;
  const status = combined.statuses.find((s) => s.context === MERGE_SAFETY_CHECK_NAME);
  if (!status) return undefined;
  return { source: 'status', state: statusState(status.state), title: status.description ?? '' };
}

/** The newest `merge-safety` check-run on `sha`, or `undefined` / `null` (failed read). */
async function readCheckRunReport(
  repo: string,
  sha: string,
  call: GhCallOptions,
): Promise<MergeSafetyReport | undefined | null> {
  // `check_name` is an exact match, so job entries such as `merge-safety / Evaluate
  // one PR` never qualify. Several runs can share the name after a burst of PR
  // events; the newest (highest id) is the one GitHub resolves the check from.
  const list = await readJson<{ check_runs: RawCheckRun[] }>(
    `repos/${repo}/commits/${sha}/check-runs?check_name=${MERGE_SAFETY_CHECK_NAME}&filter=latest`,
    false,
    call,
  );
  if (list === null) return null;
  const run = list.check_runs.reduce<RawCheckRun | undefined>(
    (newest, r) => (newest === undefined || r.id > newest.id ? r : newest),
    undefined,
  );
  if (!run) return undefined;
  return { source: 'check-run', state: checkRunState(run), title: run.output?.title ?? '' };
}

/** Read one PR's merge-safety snapshot, or `null` when any read fails. */
export async function readMergeSafetySnapshot(
  repo: string,
  pr: number,
  call: GhCallOptions = {},
): Promise<MergeSafetySnapshot | null> {
  const pull = await readJson<RawHeadPull>(`repos/${repo}/pulls/${pr}`, false, call);
  if (!pull?.head?.sha) return null;
  const state = prState(pull);
  const headSha = pull.head.sha;
  if (state !== 'open') return { state, headSha, report: null };

  const status = await readStatusReport(repo, headSha, call);
  if (status === null) return null;
  if (status) return { state, headSha, report: status };
  const checkRun = await readCheckRunReport(repo, headSha, call);
  if (checkRun === null) return null;
  return { state, headSha, report: checkRun ?? null };
}
