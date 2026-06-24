import { boundedRun } from '@rmartz/agent-runtime';

/**
 * The deterministic gh-history derivation behind {@link auditPrEfficiency}.
 * Reframes the dotfiles `pr_efficiency_audit.py` profiler: it reads a PR's
 * commits, reviews, and per-SHA check-runs from GitHub and counts the
 * efficiency signals the `EfficiencyEvent.counts` schema requires. Kept in its
 * own module so the public `efficiency-audit.ts` stays a thin shape+API layer
 * (the Python original is ~526 lines; this is the heavy seam).
 *
 * All GitHub reads go through one injectable {@link GhReader} so tests are
 * hermetic — they feed in-memory JSON and never touch the network. The real
 * reader shells out via `boundedRun('gh', ['api', …])`.
 */

const GH_TIMEOUT_MS = 30_000;
const GA_SLUG = 'github-actions';
const FAILURE_CONCLUSIONS = new Set(['failure', 'error']);

/** Checks the agent cannot run locally (e2e, integration, Vercel, …) — never blamed. */
const EXCLUDED_PATTERNS: RegExp[] = [
  /\be2e\b/,
  /\bplaywright\b/,
  /visual[_-]snapshot/,
  /\bintegration\b/,
  /\bvercel\b/,
  /ci[_-]budget/,
  /startup[_-]failure/,
];

/** Checks the agent should run locally before pushing — a failure here is preventable. */
const PREVENTABLE_PATTERNS: RegExp[] = [
  /\blint\b/,
  /\bpylint\b/,
  /\bformat\b/,
  /\bprettier\b/,
  /\btypecheck\b/,
  /\btsc\b/,
  /\bblack\b/,
  /\bunittest\b/,
  /\bpytest\b/,
  /\btests?\b/,
];

/** The `/review` skill-meta marker in a review body (excludes human/Copilot/merge reviews). */
const REVIEW_SKILL_META_RE = /<!--\s*skill-meta:\s*\{[^}]*"skill"\s*:\s*"review"/i;

/** Raw shapes from the GitHub REST API (only the fields we read). */
interface RawCommit {
  sha?: string;
  parents?: { sha?: string }[];
  author?: { login?: string } | null;
}
interface RawReview {
  body?: string;
  commit_id?: string;
  submitted_at?: string;
}
interface RawCheckRun {
  name?: string;
  conclusion?: string | null;
  app?: { slug?: string } | null;
}

/**
 * Injectable GitHub reader. Each method returns parsed JSON for a paginated
 * endpoint. The default {@link ghReader} shells out; tests pass a stub.
 */
export interface GhReader {
  commits(repo: string, pr: number): Promise<RawCommit[]>;
  reviews(repo: string, pr: number): Promise<RawReview[]>;
  checkRuns(repo: string, sha: string): Promise<RawCheckRun[]>;
}

async function ghApiSlurp(path: string): Promise<unknown> {
  const r = await boundedRun('gh', ['api', path, '--paginate', '--slurp'], {
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (r.code !== 0) throw new Error(`gh api ${path} failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout || '[]') as unknown;
}

/** Flatten `--slurp` pages (an array of page-arrays) into one flat array. */
function flattenPages<T>(pages: unknown): T[] {
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((page) => (Array.isArray(page) ? (page as T[]) : []));
}

/** The real reader: `gh api … --paginate --slurp` for each endpoint. */
export const ghReader: GhReader = {
  async commits(repo, pr) {
    return flattenPages<RawCommit>(await ghApiSlurp(`repos/${repo}/pulls/${pr}/commits`));
  },
  async reviews(repo, pr) {
    return flattenPages<RawReview>(await ghApiSlurp(`repos/${repo}/pulls/${pr}/reviews`));
  },
  async checkRuns(repo, sha) {
    const pages = await ghApiSlurp(`repos/${repo}/commits/${sha}/check-runs`);
    if (!Array.isArray(pages)) return [];
    return pages.flatMap((page) => {
      const runs = (page as { check_runs?: RawCheckRun[] })?.check_runs;
      return Array.isArray(runs) ? runs : [];
    });
  },
};

/**
 * Classify a check name as preventable. Excluded patterns take priority — a
 * check matching both is excluded so it is never counted as preventable.
 */
function isPreventableCheck(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXCLUDED_PATTERNS.some((p) => p.test(lower))) return false;
  return PREVENTABLE_PATTERNS.some((p) => p.test(lower));
}

/** Per-SHA tallies derived from one commit's GA check-runs. */
interface CheckTally {
  preventableFailures: number;
  flakes: number;
  ciRuns: number;
}

/**
 * Classify GA check-runs for one SHA. Groups by check name over terminal
 * conclusions only (in-progress/queued skipped):
 * - failure + success for the same name → flaky retry (priority)
 * - failure only, preventable check    → preventable CI failure
 * - any GA name that ran               → one CI run
 */
function classifyCheckRuns(checkRuns: RawCheckRun[]): CheckTally {
  const byName = new Map<string, string[]>();
  for (const run of checkRuns) {
    if (run.app?.slug !== GA_SLUG) continue;
    if (run.conclusion === null || run.conclusion === undefined) continue;
    const name = run.name ?? '';
    const list = byName.get(name) ?? [];
    list.push(run.conclusion);
    byName.set(name, list);
  }

  const tally: CheckTally = { preventableFailures: 0, flakes: 0, ciRuns: byName.size };
  for (const [name, conclusions] of byName) {
    const hasFailure = conclusions.some((c) => FAILURE_CONCLUSIONS.has(c));
    if (!hasFailure) continue;
    const hasSuccess = conclusions.includes('success');
    if (hasSuccess) {
      tally.flakes += 1; // failed then passed at the same SHA (re-run)
    } else if (isPreventableCheck(name)) {
      tally.preventableFailures += 1;
    }
    // excluded / other failure-only → not counted
  }
  return tally;
}

/** Count /review verdicts posted on the same SHA as the prior /review verdict. */
function countRedundantReviews(reviews: RawReview[]): number {
  const skillReviews = reviews
    .filter((r) => typeof r.body === 'string' && REVIEW_SKILL_META_RE.test(r.body))
    .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''));

  let redundant = 0;
  for (let i = 1; i < skillReviews.length; i++) {
    const prev = skillReviews[i - 1];
    const curr = skillReviews[i];
    if (prev?.commit_id && prev.commit_id === curr?.commit_id) redundant += 1;
  }
  return redundant;
}

/** The seven count signals from the `EfficiencyEvent.counts` schema. */
export interface EfficiencyCounts {
  reviewIterations: number;
  fixReviewIterations: number;
  ciRuns: number;
  preventableCiFailures: number;
  redundantReviews: number;
  flakyRetries: number;
  mergeAttempts: number;
}

/**
 * Derive the `EfficiencyEvent.counts` for one PR from GitHub history.
 *
 * - **reviewIterations** — count of `/review` verdicts (skill-meta marked).
 * - **fixReviewIterations** — author (non-merge, non-web-flow) commits, the
 *   fix-review pushes between reviews.
 * - **ciRuns** — distinct GA checks across all non-merge commits.
 * - **preventableCiFailures** — locally-runnable checks that failed.
 * - **redundantReviews** — `/review` posted twice on the same SHA.
 * - **flakyRetries** — a check that failed then passed at the same SHA.
 * - **mergeAttempts** — merge commits (branch syncs) on the branch + 1 for the
 *   eventual merge of the PR itself.
 */
export async function deriveCounts(
  repo: string,
  pr: number,
  reader: GhReader = ghReader,
): Promise<EfficiencyCounts> {
  const [commits, reviews] = await Promise.all([
    reader.commits(repo, pr),
    reader.reviews(repo, pr),
  ]);

  let fixReviewIterations = 0;
  let ciRuns = 0;
  let preventableCiFailures = 0;
  let flakyRetries = 0;
  let mergeCommits = 0;

  for (const commit of commits) {
    const parents = commit.parents ?? [];
    if (parents.length > 1) {
      mergeCommits += 1; // a branch-sync / merge commit; no CI analysis on it
      continue;
    }
    const login = (commit.author?.login ?? '').toLowerCase();
    if (login === 'web-flow') continue; // browser-edited; skip CI + iteration count

    fixReviewIterations += 1;
    const sha = commit.sha ?? '';
    if (!sha) continue;
    const tally = classifyCheckRuns(await reader.checkRuns(repo, sha));
    ciRuns += tally.ciRuns;
    preventableCiFailures += tally.preventableFailures;
    flakyRetries += tally.flakes;
  }

  const reviewIterations = reviews.filter(
    (r) => typeof r.body === 'string' && REVIEW_SKILL_META_RE.test(r.body),
  ).length;

  return {
    reviewIterations,
    fixReviewIterations,
    ciRuns,
    preventableCiFailures,
    redundantReviews: countRedundantReviews(reviews),
    flakyRetries,
    mergeAttempts: mergeCommits + 1,
  };
}
