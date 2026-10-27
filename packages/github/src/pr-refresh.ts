import { ghCall, issueNumber, type GhCallOptions } from './gh-call.js';
import { addIssueComment } from './issue-ops.js';
import {
  DEFAULT_DEPENDABOT_REFRESH_POLICY,
  DEPENDABOT_LOGIN,
  decideDependabotRefresh,
  type DependabotRefreshPolicy,
} from './dependabot-refresh.js';
import {
  readBehindBy,
  readDependabotTimeline,
  readPrRefreshState,
  type PrRefreshState,
} from './pr-refresh-reads.js';

/**
 * One entry point for "bring this PR current against its base", whoever authored
 * it. The caller states the goal; the strategy is picked from the PR's author:
 *
 * - **Dependabot** owns its branch, so only a `@dependabot rebase|recreate`
 *   comment may update it. `decideDependabotRefresh` chooses which, or to wait.
 * - **Any other PR** goes through GitHub's `update-branch` API (a merge of the
 *   base into the head), pinned to the head SHA that was read.
 *
 * Stateless by design: every decision is re-derived from the PR, so two agents
 * calling this at once reach the same answer.
 */

export const PR_REFRESH_OUTCOMES = [
  'already-current',
  'requested-rebase',
  'requested-recreate',
  'updated',
  'pending',
  'escalate',
  'closed',
  'failed',
] as const;
export type PrRefreshOutcome = (typeof PR_REFRESH_OUTCOMES)[number];

export interface PrRefreshResult {
  outcome: PrRefreshOutcome;
  reason: string;
}

export interface RefreshPrOptions extends GhCallOptions {
  /** Act even when the branch reads as current (e.g. Dependabot wrongly claims it is). */
  force?: boolean;
  /** Override the Dependabot wait windows / retry cap. */
  policy?: Partial<DependabotRefreshPolicy>;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

async function refreshDependabot(
  repo: string,
  pr: string,
  pull: PrRefreshState,
  opts: RefreshPrOptions,
): Promise<PrRefreshResult> {
  const timeline = await readDependabotTimeline(repo, pr, pull.body, opts);
  if (!timeline) return { outcome: 'failed', reason: 'could not read the PR timeline' };
  const policy = { ...DEFAULT_DEPENDABOT_REFRESH_POLICY, ...opts.policy };
  const decision = decideDependabotRefresh(timeline, (opts.now ?? (() => new Date()))(), policy);
  if (decision.action === 'wait') return { outcome: 'pending', reason: decision.reason };
  if (decision.action === 'escalate') return { outcome: 'escalate', reason: decision.reason };
  const posted = await addIssueComment(repo, pr, `@dependabot ${decision.command}`, opts);
  if (posted === null) {
    return { outcome: 'failed', reason: `could not post @dependabot ${decision.command}` };
  }
  return {
    outcome: decision.command === 'rebase' ? 'requested-rebase' : 'requested-recreate',
    reason: decision.reason,
  };
}

async function refreshViaUpdateBranch(
  repo: string,
  pr: string,
  pull: PrRefreshState,
  opts: RefreshPrOptions,
): Promise<PrRefreshResult> {
  if (pull.mergeable === false) {
    return { outcome: 'escalate', reason: 'merge conflict needs resolving by hand' };
  }
  const out = await ghCall(
    {
      argv: ['gh', 'api', '-X', 'PUT', `repos/${repo}/pulls/${pr}/update-branch`, '--input', '-'],
      stdin: JSON.stringify({ expected_head_sha: pull.headSha }),
    },
    null,
    opts,
  );
  if (out === null) return { outcome: 'failed', reason: 'update-branch request failed' };
  return { outcome: 'updated', reason: `merged ${pull.baseRef} into the branch` };
}

/** Bring `pr` current against its base, choosing the strategy by author. */
export async function refreshPr(
  repo: string,
  pr: string | number,
  opts: RefreshPrOptions = {},
): Promise<PrRefreshResult> {
  const num = issueNumber(pr);
  if (num === null) return { outcome: 'failed', reason: `not a PR reference: ${pr}` };
  const pull = await readPrRefreshState(repo, num, opts);
  if (!pull) return { outcome: 'failed', reason: 'could not read the PR' };
  if (pull.state !== 'open') return { outcome: 'closed', reason: `PR is ${pull.state}` };

  if (!opts.force) {
    const behindBy = await readBehindBy(repo, pull.baseRef, pull.headSha, opts);
    if (behindBy === null) return { outcome: 'failed', reason: 'could not compare against base' };
    if (behindBy === 0 && pull.mergeable !== false) {
      return { outcome: 'already-current', reason: `up to date with ${pull.baseRef}` };
    }
  }
  return pull.author === DEPENDABOT_LOGIN
    ? refreshDependabot(repo, num, pull, opts)
    : refreshViaUpdateBranch(repo, num, pull, opts);
}
