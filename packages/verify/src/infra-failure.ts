/**
 * Detect when a PR's CI failure is a non-fixable *infrastructure* event.
 *
 * A normal CI failure (a lint rule, a type error, a failing test) is fixable: a
 * code change can make it pass. An *infrastructure* failure is not — the jobs
 * never ran. The canonical cause is a GitHub Actions billing / spending-limit
 * lapse (the runner can't be allocated), but a runner-pool outage or an org
 * disabling Actions produces the same signature. No code change can fix it, so a
 * caller that auto-creates a fix PR would just produce a noop PR.
 *
 * Two signatures mark "the jobs never started":
 *   1. Run conclusion `startup_failure` — GitHub's explicit "runner could not be
 *      allocated" signal.
 *   2. A `failure` run whose failing jobs executed zero steps. Billing lapses
 *      often surface as check runs concluding `failure` (not `startup_failure`)
 *      with an empty `steps` array, because the job was never assigned a runner.
 *      A genuine code failure always runs setup steps before the failing one.
 *
 * Conservative: if *any* failing run shows a real executed step that failed, the
 * whole head is treated as fixable (`false`). On any `gh`/JSON error it
 * soft-fails to `false` (treat as fixable). TS port of dotfiles'
 * `detect_ci_infra_failure.py`; all subprocess goes through `boundedRun`.
 */

import { boundedRun } from '@rmartz/agent-runtime';

const GH_API_TIMEOUT_MS = 30_000;
const DEFAULT_PER_PAGE = 30;

// Terminal, non-passing conclusions. `startup_failure` is unambiguous infra;
// `failure` needs per-job step inspection. `cancelled` / `timed_out` are
// infra-adjacent but handled by other gates, so they are ignored here.
const REAL_OR_INFRA: ReadonlySet<string> = new Set(['failure', 'startup_failure']);

/** A worflow run, as returned by the Actions runs endpoint (only fields used). */
interface WorkflowRun {
  id?: number;
  name?: string;
  conclusion?: string;
}

/** A job step (only the conclusion is inspected). */
interface JobStep {
  conclusion?: string | null;
}

/** A workflow job (only fields used). */
interface WorkflowJob {
  conclusion?: string;
  steps?: JobStep[];
}

/** Injectable subprocess boundary so tests never shell out to real `gh`. */
export type GhRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; code: number | null }>;

const defaultRunner: GhRunner = async (command, args) => {
  const r = await boundedRun(command, args, { timeoutMs: GH_API_TIMEOUT_MS });
  return { stdout: r.stdout, code: r.code };
};

export interface InfraFailureResult {
  isInfra: boolean;
  reason: string;
}

export interface IsInfraFailureOptions {
  perPage?: number;
  runner?: GhRunner;
}

/** Run `gh api <endpoint>` and return parsed JSON, or throw on failure. */
async function ghJson(runner: GhRunner, endpoint: string): Promise<unknown> {
  const r = await runner('gh', ['api', endpoint]);
  if (r.code !== 0) throw new Error(`gh api exited ${r.code ?? 'null'}`);
  return JSON.parse(r.stdout) as unknown;
}

/**
 * For a `failure` run, did every failing job execute zero steps? Returns `true`
 * when at least one job failed and *all* failed jobs have no executed step
 * (never started — infra); `false` when any failed job executed a step (a real,
 * fixable failure); `null` when the jobs cannot be fetched/parsed.
 */
async function failingJobsAllUnstarted(
  repo: string,
  runId: number | undefined,
  runner: GhRunner,
): Promise<boolean | null> {
  let data: unknown;
  try {
    data = await ghJson(runner, `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  } catch {
    return null;
  }
  const jobs =
    typeof data === 'object' && data !== null && Array.isArray((data as { jobs?: unknown }).jobs)
      ? ((data as { jobs: WorkflowJob[] }).jobs ?? [])
      : [];
  const failedJobs = jobs.filter((j) => j?.conclusion === 'failure');
  if (failedJobs.length === 0) return null;
  // A step counts as "executed" once it has a conclusion other than skipped; a
  // billing-blocked job has no steps at all, so an empty list trivially has none.
  for (const job of failedJobs) {
    const steps = job.steps ?? [];
    if (steps.some((s) => s.conclusion != null && s.conclusion !== 'skipped')) {
      return false;
    }
  }
  return true;
}

/**
 * Return `{ isInfra, reason }` for the CI state on `headSha`. `isInfra` is
 * `true` only on positive evidence of never-started jobs with no competing
 * evidence of a real failure; `false` for a fixable code failure, no failing
 * runs, or a soft-failed API call.
 */
export async function isInfraFailure(
  repo: string,
  headSha: string,
  opts: IsInfraFailureOptions = {},
): Promise<InfraFailureResult> {
  const runner = opts.runner ?? defaultRunner;
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
  const endpoint = `/repos/${repo}/actions/runs?head_sha=${headSha}&per_page=${perPage}`;

  let data: unknown;
  try {
    data = await ghJson(runner, endpoint);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isInfra: false, reason: `infra-failure check skipped — gh api failed: ${msg}` };
  }

  const runs =
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { workflow_runs?: unknown }).workflow_runs)
      ? ((data as { workflow_runs: WorkflowRun[] }).workflow_runs ?? [])
      : [];
  const terminal = runs.filter((r) => r.conclusion != null && REAL_OR_INFRA.has(r.conclusion));
  if (terminal.length === 0) {
    return { isInfra: false, reason: `no failed/startup_failure runs on ${headSha.slice(0, 7)}` };
  }

  const infraReasons: string[] = [];
  for (const run of terminal) {
    const name = run.name || `run ${run.id ?? '?'}`;
    if (run.conclusion === 'startup_failure') {
      infraReasons.push(`${name}: startup_failure (runner not allocated)`);
      continue;
    }
    // conclusion === "failure": distinguish never-started from real failure.
    const verdict = await failingJobsAllUnstarted(repo, run.id, runner);
    if (verdict === false) {
      // A real executed step failed — fixable. One genuine code failure is
      // enough to disqualify the whole head from infra.
      return {
        isInfra: false,
        reason: `${name}: failing job executed steps — genuine code failure, fixable via a fix PR`,
      };
    }
    if (verdict === true) {
      infraReasons.push(`${name}: failed with zero executed steps`);
    }
    // verdict === null → inconclusive for this run; keep scanning others.
  }

  if (infraReasons.length > 0) {
    return {
      isInfra: true,
      reason:
        'CI failure looks like a non-fixable infrastructure event ' +
        '(GitHub Actions billing/spending-limit or runner outage) — jobs never started: ' +
        infraReasons.join('; '),
    };
  }
  return {
    isInfra: false,
    reason: `failing runs on ${headSha.slice(0, 7)} were inconclusive — treating as fixable`,
  };
}
