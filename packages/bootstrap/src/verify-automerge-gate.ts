import { ghCall, resolveRepoTarget, type RepoTargetOptions } from '@rmartz/github';
import { goldenGateChecks } from './golden-config.js';

/**
 * Confirm (and optionally apply) the branch-protection gate that GitHub-native
 * Dependabot auto-merge depends on. Network-touching, so it lives here rather
 * than in the hermetic `ensure-project-config` writer.
 *
 * Protection is expressed as a **Ruleset**, not classic branch protection —
 * classic rules are a legacy mechanism the fleet migrates away from. The read
 * path resolves the *effective* required checks from the Rulesets API, and
 * `--apply` provisions a tool-managed ruleset ({@link MANAGED_RULESET_NAME}).
 * Legacy classic protection, if any lingers, still counts toward the gate (so a
 * mid-migration repo isn't falsely reported unsatisfied) but is surfaced as
 * **drift** to migrate — it is never written and never deleted here.
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

/**
 * Name of the tool-owned ruleset `--apply` provisions. Find-or-update keys off
 * this name, so re-running converges on one ruleset rather than accumulating
 * duplicates, and a repo's own hand-authored rulesets are left untouched.
 */
const MANAGED_RULESET_NAME = 'Auto-merge gate';

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
  /** Effective status-check contexts required on the default branch (ruleset ∪ classic). */
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
  /**
   * Whether legacy **classic** branch protection still requires status checks on
   * the branch. It counts toward {@link satisfied} (fail-closed union), but is a
   * migration-drift signal: the fleet standardizes on Rulesets, so classic
   * protection should be removed once the ruleset is in place.
   */
  classicProtection: boolean;
  /** `allowAutoMerge` on AND no missing gate checks AND the squash commit setting correct. */
  satisfied: boolean;
  /** Whether `--apply` mutated repo/branch state during this run. */
  applied: boolean;
}

interface ClassicRequiredChecksResponse {
  contexts?: string[];
  checks?: { context?: string }[];
}

/** One effective rule as reported by the Rulesets API (only the parts we read). */
interface BranchRule {
  type?: string;
  parameters?: { required_status_checks?: { context?: string }[] };
}

interface RulesetSummary {
  id?: number;
  name?: string;
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

/** Collect the unique `required_status_checks` contexts out of a set of rules. */
function contextsFromRules(rules: BranchRule[]): string[] {
  return [
    ...new Set(
      rules
        .filter((r) => r.type === 'required_status_checks')
        .flatMap((r) => r.parameters?.required_status_checks ?? [])
        .map((c) => c.context)
        .filter((c): c is string => !!c),
    ),
  ];
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
 * The status-check contexts required by **Rulesets** on `branch` — the effective
 * set across every active ruleset, read via the Rulesets API. The endpoint
 * reports only ruleset-based rules (classic protection is read separately); a
 * branch with no ruleset rules reads as `[]`, the fail-closed direction.
 */
async function readRulesetRequiredChecks(
  repo: string,
  branch: string,
  opts: RepoTargetOptions,
): Promise<string[]> {
  const rules = await readJson<BranchRule[]>(
    ['gh', 'api', `repos/${repo}/rules/branches/${branch}`],
    opts,
  );
  return rules ? contextsFromRules(rules) : [];
}

/**
 * The status-check contexts required by **classic** branch protection on
 * `branch`, or `null` when no classic protection object exists (404 → the
 * fail-closed direction). Non-null is the migration-drift signal.
 */
async function readClassicRequiredChecks(
  repo: string,
  branch: string,
  opts: RepoTargetOptions,
): Promise<string[] | null> {
  const res = await readJson<ClassicRequiredChecksResponse>(
    ['gh', 'api', `repos/${repo}/branches/${branch}/protection/required_status_checks`],
    opts,
  );
  if (!res) return null;
  const fromChecks = (res.checks ?? []).map((c) => c.context).filter((c): c is string => !!c);
  return [...new Set([...(res.contexts ?? []), ...fromChecks])];
}

/** The tool-managed ruleset's id, or `null` when it does not exist yet. */
async function findManagedRuleset(repo: string, opts: RepoTargetOptions): Promise<number | null> {
  const list = await readJson<RulesetSummary[]>(['gh', 'api', `repos/${repo}/rulesets`], opts);
  if (!list) return null;
  return list.find((r) => r.name === MANAGED_RULESET_NAME)?.id ?? null;
}

/** The contexts the managed ruleset currently requires (empty if it has none). */
async function readManagedRulesetContexts(
  repo: string,
  id: number,
  opts: RepoTargetOptions,
): Promise<string[]> {
  const detail = await readJson<{ rules?: BranchRule[] }>(
    ['gh', 'api', `repos/${repo}/rulesets/${id}`],
    opts,
  );
  return contextsFromRules(detail?.rules ?? []);
}

/**
 * The managed ruleset body: a single `required_status_checks` rule over the
 * default branch. `strict_required_status_checks_policy` is **false** by design
 * — requiring branches to be up-to-date (strict) would re-pend every open PR
 * whenever the base moves, churning against the `merge-safety` check that already
 * observes staleness advisorily. A review policy is deliberately not set here.
 */
function rulesetBody(contexts: string[]): string {
  return JSON.stringify({
    name: MANAGED_RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: contexts.map((c) => ({ context: c })),
          strict_required_status_checks_policy: false,
        },
      },
    ],
  });
}

/** Enable `allow_auto_merge` on the repo. Throws on write failure. */
async function enableAutoMerge(repo: string, opts: RepoTargetOptions): Promise<void> {
  const out = await ghCall(
    { argv: ['gh', 'api', '--method', 'PATCH', `repos/${repo}`, '-F', 'allow_auto_merge=true'] },
    null,
    opts,
  );
  if (out === null) throw new Error(`failed to enable allow_auto_merge on ${repo}`);
}

/**
 * Create-or-update the managed ruleset so it requires the union of its current
 * contexts and `gateChecks`. Idempotent: re-running finds the same ruleset by
 * name and PUTs the converged body rather than creating a second one. Never
 * writes classic branch protection.
 */
async function applyRulesetGate(
  repo: string,
  gateChecks: readonly string[],
  opts: RepoTargetOptions,
): Promise<void> {
  const id = await findManagedRuleset(repo, opts);
  const existing = id === null ? [] : await readManagedRulesetContexts(repo, id, opts);
  const body = rulesetBody([...new Set([...existing, ...gateChecks])]);
  const argv =
    id === null
      ? ['gh', 'api', '--method', 'POST', `repos/${repo}/rulesets`, '--input', '-']
      : ['gh', 'api', '--method', 'PUT', `repos/${repo}/rulesets/${id}`, '--input', '-'];
  const out = await ghCall({ argv, stdin: body }, null, opts);
  if (out === null) {
    throw new Error(
      `failed to ${id === null ? 'create' : 'update'} the auto-merge ruleset on ${repo}`,
    );
  }
}

/**
 * Confirm the auto-merge gate on a repo's default branch; with `apply`, bring it
 * into the required state (provisioning a Ruleset, never classic protection).
 * Returns the observed (post-apply, if applied) state. `satisfied === false` is
 * the hard signal the `/bootstrap` skill blocks on.
 */
export async function verifyAutomergeGate(
  opts: VerifyAutomergeGateOptions = {},
): Promise<VerifyAutomergeGateResult> {
  const repo = await resolveRepoTarget(opts);
  if (!repo) throw new Error('could not determine repo (pass --repo or run in a repo checkout)');
  const gateChecks = [...(opts.gateChecks ?? goldenGateChecks)];
  const branch = await defaultBranch(repo, opts);

  let allowAutoMerge = await readAllowAutoMerge(repo, opts);
  const rulesetChecks = await readRulesetRequiredChecks(repo, branch, opts);
  const classicChecks = await readClassicRequiredChecks(repo, branch, opts);
  const classicProtection = classicChecks !== null;
  let requiredChecks = [...new Set([...rulesetChecks, ...(classicChecks ?? [])])];
  let missingChecks = gateChecks.filter((c) => !requiredChecks.includes(c));
  let squashCommitCorrect = await readSquashCommitCorrect(repo, opts);

  let applied = false;
  const gateIncomplete = missingChecks.length > 0 || !allowAutoMerge;
  if (opts.apply && (gateIncomplete || !squashCommitCorrect)) {
    if (gateIncomplete) {
      if (!allowAutoMerge) {
        await enableAutoMerge(repo, opts);
        allowAutoMerge = true;
      }
      await applyRulesetGate(repo, gateChecks, opts);
      requiredChecks = [...new Set([...requiredChecks, ...gateChecks])];
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
    classicProtection,
    satisfied: allowAutoMerge && missingChecks.length === 0 && squashCommitCorrect,
    applied,
  };
}
