import { ghCall, type RepoTargetOptions } from '@rmartz/github';

/**
 * Name of the tool-owned ruleset `--apply` provisions. Find-or-update keys off
 * this name, so re-running converges on one ruleset rather than accumulating
 * duplicates, and a repo's own hand-authored rulesets are left untouched.
 */
const MANAGED_RULESET_NAME = 'Auto-merge gate';

/** One effective rule as reported by the Rulesets API (only the parts we read). */
interface BranchRule {
  type?: string;
  parameters?: { required_status_checks?: { context?: string }[] };
}

interface RulesetSummary {
  id?: number;
  name?: string;
}

export async function readJson<T>(argv: string[], opts: RepoTargetOptions): Promise<T | null> {
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

/**
 * The status-check contexts required by **Rulesets** on `branch` — the effective
 * set across every active ruleset, read via the Rulesets API. The endpoint
 * reports only ruleset-based rules (classic protection is read separately); a
 * branch with no ruleset rules reads as `[]`, the fail-closed direction.
 */
export async function readRulesetRequiredChecks(
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

/**
 * Create-or-update the managed ruleset so it requires the union of its current
 * contexts and `gateChecks`. Idempotent: re-running finds the same ruleset by
 * name and PUTs the converged body rather than creating a second one. Never
 * writes classic branch protection.
 */
export async function applyRulesetGate(
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
