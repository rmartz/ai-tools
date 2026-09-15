import { ghCall, resolveRepoTarget, type RepoTargetOptions } from '@rmartz/github';
import { goldenGateChecks } from './golden-config.js';

/**
 * Confirm (and optionally apply) the branch-protection gate that GitHub-native
 * Dependabot auto-merge depends on. Network-touching, so it lives here rather
 * than in the hermetic `ensure-project-config` writer.
 *
 * The hazard this closes: `gh pr merge --auto` fires the instant a PR's required
 * checks are green — and with **no** required checks configured, "green" is
 * immediate, so the seeded auto-merge workflow would clear every patch/minor
 * Dependabot PR with zero gate. Reading whether a check is *required* needs
 * admin-level access the workflow's `GITHUB_TOKEN` generally lacks; the user's
 * `gh` auth does have it. So the confirmation lives in this bootstrap/agent step,
 * where a missing gate fails loudly, rather than in the workflow at runtime.
 *
 * It also confirms the repo's **squash-merge commit setting** (PR title + body):
 * under auto-merge an auto-merged PR must land a conventional commit subject (its
 * PR title) or release-please silently skips it. That coupling makes the squash
 * setting part of the same gate — a repo enabling auto-merge without it would
 * quietly break its releases on every auto-merged PR.
 */

export interface VerifyAutomergeGateOptions extends RepoTargetOptions {
  /** Opt-in, state-changing: set the required checks + enable `allow_auto_merge`. */
  apply?: boolean;
  /** Gate-check contexts that must be required. Defaults to {@link goldenGateChecks}. */
  gateChecks?: readonly string[];
}

export interface VerifyAutomergeGateResult {
  repo: string;
  branch: string;
  /** Whether the repo allows auto-merge (`allow_auto_merge`). */
  allowAutoMerge: boolean;
  /** Status-check contexts currently marked required on the default branch. */
  requiredChecks: string[];
  /** The gate set that was checked. */
  gateChecks: string[];
  /** Gate checks not currently required — non-empty means the gate is incomplete. */
  missingChecks: string[];
  /**
   * Whether the repo's squash-merge commit is configured to take the **PR title +
   * body** (`squash_merge_commit_title=PR_TITLE`, `squash_merge_commit_message=PR_BODY`).
   * Under auto-merge this is load-bearing: an auto-merged PR must land a
   * conventional commit subject (from the PR title) or release-please silently
   * skips it — the exact miss that stranded a github release.
   */
  squashCommitCorrect: boolean;
  /** `allowAutoMerge` on AND no missing gate checks AND the squash commit setting correct. */
  satisfied: boolean;
  /** Whether `--apply` mutated repo/branch state during this run. */
  applied: boolean;
}

interface RequiredChecksResponse {
  contexts?: string[];
  checks?: { context?: string }[];
}

async function readJson<T>(argv: string[], opts: RepoTargetOptions): Promise<T | null> {
  const out = await ghCall({ argv }, null, opts);
  if (out === null) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

/** Resolve the repo's default branch name via `gh repo view`. */
async function defaultBranch(repo: string, opts: RepoTargetOptions): Promise<string> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'repo',
        'view',
        repo,
        '--json',
        'defaultBranchRef',
        '--jq',
        '.defaultBranchRef.name',
      ],
    },
    null,
    opts,
  );
  const branch = out?.trim();
  if (!branch) throw new Error(`could not resolve the default branch of ${repo}`);
  return branch;
}

/** Read `allow_auto_merge` on the repo object (readable without admin). */
async function readAllowAutoMerge(repo: string, opts: RepoTargetOptions): Promise<boolean> {
  const out = await ghCall(
    { argv: ['gh', 'api', `repos/${repo}`, '--jq', '.allow_auto_merge'] },
    null,
    opts,
  );
  return out?.trim() === 'true';
}

/**
 * The squash-merge commit config a release-please repo needs so a merged PR's
 * subject is its (conventional) PR title, with the description as the body.
 */
const DESIRED_SQUASH_TITLE = 'PR_TITLE';
const DESIRED_SQUASH_MESSAGE = 'PR_BODY';

interface RepoSquashSettings {
  squash_merge_commit_title?: string;
  squash_merge_commit_message?: string;
}

/** True when the repo's squash-merge commit is set to PR title + PR body. */
async function readSquashCommitCorrect(repo: string, opts: RepoTargetOptions): Promise<boolean> {
  const res = await readJson<RepoSquashSettings>(
    [
      'gh',
      'api',
      `repos/${repo}`,
      '--jq',
      '{squash_merge_commit_title, squash_merge_commit_message}',
    ],
    opts,
  );
  return (
    res?.squash_merge_commit_title === DESIRED_SQUASH_TITLE &&
    res?.squash_merge_commit_message === DESIRED_SQUASH_MESSAGE
  );
}

/** Set the squash-merge commit to PR title + body. Throws on write failure. */
async function applySquashCommitSetting(repo: string, opts: RepoTargetOptions): Promise<void> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '--method',
        'PATCH',
        `repos/${repo}`,
        '-f',
        `squash_merge_commit_title=${DESIRED_SQUASH_TITLE}`,
        '-f',
        `squash_merge_commit_message=${DESIRED_SQUASH_MESSAGE}`,
      ],
    },
    null,
    opts,
  );
  if (out === null) throw new Error(`failed to set the squash-merge commit setting on ${repo}`);
}

/**
 * Read the contexts currently marked required on `branch`. A branch with no
 * protection (or no required checks) 404s / soft-fails to `null`, which we read as
 * "no required checks" — the fail-closed direction, so an unprotected branch
 * reports the gate as missing rather than silently satisfied.
 */
async function readRequiredChecks(
  repo: string,
  branch: string,
  opts: RepoTargetOptions,
): Promise<string[]> {
  const res = await readJson<RequiredChecksResponse>(
    ['gh', 'api', `repos/${repo}/branches/${branch}/protection/required_status_checks`],
    opts,
  );
  if (!res) return [];
  const fromChecks = (res.checks ?? []).map((c) => c.context).filter((c): c is string => !!c);
  return [...new Set([...(res.contexts ?? []), ...fromChecks])];
}

/**
 * Apply the gate: enable `allow_auto_merge` if off, and PUT a minimal branch
 * protection requiring the union of the currently-required and gate contexts
 * (strict). PUT replaces the whole protection object, so review/restriction
 * requirements are set to `null` — apply configures a strict required-checks gate,
 * not a review policy. Each write is surfaced (the caller opted in); a failed
 * write throws rather than silently leaving the gate incomplete.
 */
async function applyGate(
  repo: string,
  branch: string,
  desiredContexts: string[],
  needAllowAutoMerge: boolean,
  opts: RepoTargetOptions,
): Promise<void> {
  if (needAllowAutoMerge) {
    const out = await ghCall(
      { argv: ['gh', 'api', '--method', 'PATCH', `repos/${repo}`, '-F', 'allow_auto_merge=true'] },
      null,
      opts,
    );
    if (out === null) throw new Error(`failed to enable allow_auto_merge on ${repo}`);
  }
  const body = JSON.stringify({
    required_status_checks: { strict: true, contexts: desiredContexts },
    enforce_admins: null,
    required_pull_request_reviews: null,
    restrictions: null,
  });
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '--method',
        'PUT',
        `repos/${repo}/branches/${branch}/protection`,
        '--input',
        '-',
      ],
      stdin: body,
    },
    null,
    opts,
  );
  if (out === null) throw new Error(`failed to set required status checks on ${repo}@${branch}`);
}

/**
 * Confirm the auto-merge gate on a repo's default branch; with `apply`, bring it
 * into the required state. Returns the observed (post-apply, if applied) state.
 * `satisfied === false` is the hard signal the `/bootstrap` skill blocks on.
 */
export async function verifyAutomergeGate(
  opts: VerifyAutomergeGateOptions = {},
): Promise<VerifyAutomergeGateResult> {
  const repo = await resolveRepoTarget(opts);
  if (!repo) throw new Error('could not determine repo (pass --repo or run in a repo checkout)');
  const gateChecks = [...(opts.gateChecks ?? goldenGateChecks)];
  const branch = await defaultBranch(repo, opts);

  let allowAutoMerge = await readAllowAutoMerge(repo, opts);
  let requiredChecks = await readRequiredChecks(repo, branch, opts);
  let missingChecks = gateChecks.filter((c) => !requiredChecks.includes(c));
  let squashCommitCorrect = await readSquashCommitCorrect(repo, opts);

  let applied = false;
  const gateIncomplete = missingChecks.length > 0 || !allowAutoMerge;
  if (opts.apply && (gateIncomplete || !squashCommitCorrect)) {
    if (gateIncomplete) {
      const desiredContexts = [...new Set([...requiredChecks, ...gateChecks])];
      await applyGate(repo, branch, desiredContexts, !allowAutoMerge, opts);
      allowAutoMerge = true;
      requiredChecks = desiredContexts;
      missingChecks = [];
    }
    if (!squashCommitCorrect) {
      await applySquashCommitSetting(repo, opts);
      squashCommitCorrect = true;
    }
    applied = true;
  }

  return {
    repo,
    branch,
    allowAutoMerge,
    requiredChecks,
    gateChecks,
    missingChecks,
    squashCommitCorrect,
    satisfied: allowAutoMerge && missingChecks.length === 0 && squashCommitCorrect,
    applied,
  };
}
