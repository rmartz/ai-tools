import { boundedRun } from '@rmartz/agent-runtime';
import { fetchPrSummary, gatherRepoStatus, type RepoStatus } from '@rmartz/github';

/**
 * Remove worktrees and local branches whose pull request is closed/merged. TS
 * port of dotfiles' `git_cleanup.py`.
 *
 * A branch is cleaned up **only** when it had a PR that is now closed or merged.
 * Two states are deliberately preserved (cleaning them up was the #1104
 * data-loss bug):
 *   - an **open** PR — work still in flight, and
 *   - **no PR ever** — work in progress that simply hasn't opened a PR yet.
 *
 * Runs in three phases:
 *   1. Remove secondary worktrees whose branch's PR is closed/merged — never
 *      with `--force`, and never when the worktree has uncommitted/untracked
 *      changes (those are preserved and the skip is surfaced).
 *   2. Delete local branches whose PR is closed/merged.
 *   3. Prune stale worktree administrative files with `git worktree prune`.
 *
 * Idempotent and safe to run while other sessions hold work-in-progress
 * worktrees on the same repo.
 */

const GIT_TIMEOUT_MS = 30_000;

/** A branch's pull-request state, used to decide cleanup safety. */
export type PrState = 'open' | 'closed' | 'none';

export type Log = (message: string) => void;

export interface CleanupOptions {
  cwd?: string;
  log?: Log;
}

export interface CleanupResult {
  worktreesRemoved: number;
  worktreesKept: number;
  branchesDeleted: number;
  branchesKept: number;
}

interface SecondaryWorktree {
  path: string;
  branch: string;
}

async function git(
  args: string[],
  cwd: string | undefined,
): Promise<{ stdout: string; code: number; stderr: string }> {
  try {
    const r = await boundedRun('git', args, { timeoutMs: GIT_TIMEOUT_MS, cwd });
    return { stdout: r.stdout, code: r.code ?? 1, stderr: r.stderr };
  } catch (err) {
    return { stdout: '', code: 1, stderr: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolve the repo's default branch from the cached `origin/HEAD`, else `main`. */
async function getDefaultBranch(cwd: string | undefined): Promise<string> {
  const r = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
  if (r.code === 0) {
    const ref = r.stdout.trim();
    const prefix = 'refs/remotes/origin/';
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref || 'main';
  }
  return 'main';
}

/** Current branch via `git symbolic-ref --short HEAD`, or `''` (detached). */
async function getCurrentBranch(cwd: string | undefined): Promise<string> {
  const r = await git(['symbolic-ref', '--short', 'HEAD'], cwd);
  return r.code === 0 ? r.stdout.trim() : '';
}

/**
 * Parse `git worktree list --porcelain` into (path, branch) pairs for all
 * non-main worktrees, skipping the first block (main) and detached-HEAD entries.
 */
export function parseSecondaryWorktrees(porcelain: string): SecondaryWorktree[] {
  const trimmed = porcelain.trim();
  if (!trimmed) return [];
  const blocks = trimmed.split('\n\n');
  const result: SecondaryWorktree[] = [];
  blocks.forEach((block, i) => {
    if (i === 0) return; // skip the main worktree
    const fields: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const space = line.indexOf(' ');
      if (space > 0) fields[line.slice(0, space)] = line.slice(space + 1);
    }
    const path = fields.worktree ?? '';
    const branchRef = fields.branch ?? '';
    const branch = branchRef.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : '';
    if (path && branch) result.push({ path, branch });
  });
  return result;
}

async function listSecondaryWorktrees(cwd: string | undefined): Promise<SecondaryWorktree[]> {
  const r = await git(['worktree', 'list', '--porcelain'], cwd);
  if (r.code !== 0) return [];
  return parseSecondaryWorktrees(r.stdout);
}

async function listLocalBranches(exclude: string, cwd: string | undefined): Promise<string[]> {
  const r = await git(['branch', '--format=%(refname:short)'], cwd);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && b !== exclude);
}

/**
 * Build a branch → PR-state map for `branches`, using `@rmartz/github`. A
 * `gatherRepoStatus` snapshot maps each open PR's head branch to its number; a
 * branch present there is `open`. For the rest, `fetchPrSummary` against the PR
 * number (when discoverable) classifies closed/merged; a branch with no
 * discoverable PR is `none` (pre-PR WIP — keep). Any failure yields `open` — the
 * conservative answer that never cleans up a branch it cannot confirm abandoned.
 *
 * `gatherRepoStatus` only enumerates **open** PRs, so a closed/merged PR's
 * branch is not in its `openPrs`. To classify those, we look up each unknown
 * branch's PRs via `gh pr list --head` (state `all`) — the same query the Python
 * used — and treat all-closed as `closed`, none as `none`.
 */
export async function classifyBranches(
  branches: Set<string>,
  repo: string,
  cwd: string | undefined,
  log: Log,
): Promise<Map<string, PrState>> {
  const status = await safeRepoStatus(cwd);
  const openHeads = new Set((status?.openPrs ?? []).map((pr) => pr.headRefName));
  const out = new Map<string, PrState>();
  for (const branch of branches) {
    if (openHeads.has(branch)) {
      out.set(branch, 'open');
      continue;
    }
    out.set(branch, await classifyClosedOrNone(branch, repo, cwd, log));
  }
  return out;
}

async function safeRepoStatus(cwd: string | undefined): Promise<RepoStatus | null> {
  try {
    return await gatherRepoStatus({ cwd });
  } catch {
    return null;
  }
}

/**
 * For a branch not among the open PRs, determine `closed` vs `none` (vs `open`
 * conservatively on failure). Lists the branch's PRs (any state); if any is
 * still OPEN it is `open`, if all are closed/merged it is `closed`, and if there
 * are none it is `none`.
 */
async function classifyClosedOrNone(
  branch: string,
  repo: string,
  cwd: string | undefined,
  log: Log,
): Promise<PrState> {
  const numbers = await listPrNumbersForBranch(branch, repo, cwd, log);
  if (numbers === null) return 'open'; // could not confirm — keep
  if (numbers.length === 0) return 'none';
  for (const n of numbers) {
    let summary;
    try {
      summary = await fetchPrSummary(repo, n);
    } catch {
      return 'open'; // could not confirm — keep
    }
    if ((summary.state || '').toUpperCase() === 'OPEN') return 'open';
  }
  return 'closed';
}

/** PR numbers with `branch` as head (any state), or `null` if `gh` failed. */
async function listPrNumbersForBranch(
  branch: string,
  repo: string,
  cwd: string | undefined,
  log: Log,
): Promise<number[] | null> {
  let r;
  try {
    r = await boundedRun(
      'gh',
      ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'number'],
      { timeoutMs: GIT_TIMEOUT_MS, cwd },
    );
  } catch {
    return null;
  }
  if ((r.code ?? 1) !== 0) {
    log(
      `warning: gh pr list failed for branch '${branch}'; assuming an open PR to avoid destructive cleanup`,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(r.stdout || '[]') as { number: number }[];
    return parsed.map((p) => p.number);
  } catch {
    log(
      `warning: gh pr list returned unparseable output for branch '${branch}'; assuming an open PR`,
    );
    return null;
  }
}

function keepReason(state: PrState): string {
  return state === 'open' ? 'has open PR' : 'no PR yet — work in progress';
}

/**
 * Run the full cleanup. Resolves the repo (via the same git remote) and returns
 * counts of removed/kept worktrees and deleted/kept branches.
 */
export async function runCleanup(opts: CleanupOptions = {}): Promise<CleanupResult> {
  const cwd = opts.cwd;
  const log = opts.log ?? console.log;

  const defaultBranch = await getDefaultBranch(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  const worktrees = await listSecondaryWorktrees(cwd);
  const allBranches = await listLocalBranches(defaultBranch, cwd);

  const result: CleanupResult = {
    worktreesRemoved: 0,
    worktreesKept: 0,
    branchesDeleted: 0,
    branchesKept: 0,
  };

  const branchesToCheck = new Set<string>([...worktrees.map((w) => w.branch), ...allBranches]);
  if (branchesToCheck.size === 0) {
    log('Nothing to clean up — no secondary worktrees or extra branches.');
    await git(['worktree', 'prune'], cwd);
    log(`Done — removed 0 worktree(s) (kept 0), deleted 0 branch(es) (kept 0).`);
    return result;
  }

  const repo = (await safeCurrentRepo(cwd)) ?? '';
  const status = await classifyBranches(branchesToCheck, repo, cwd, log);

  // Phase 1: remove worktrees (before branch deletion — git refuses to delete a
  // branch checked out in a worktree).
  for (const { path, branch } of worktrees) {
    const state = status.get(branch) ?? 'open';
    if (state !== 'closed') {
      log(`Keeping  worktree ${path} (branch ${branch} — ${keepReason(state)})`);
      result.worktreesKept += 1;
      continue;
    }
    const dirty = await git(['-C', path, 'status', '--porcelain'], cwd);
    if (dirty.code === 0 && dirty.stdout.trim()) {
      log(
        `Keeping  worktree ${path} (branch ${branch} — PR closed but ` +
          `worktree has uncommitted/untracked changes)`,
      );
      result.worktreesKept += 1;
      continue;
    }
    log(`Removing worktree ${path} (branch ${branch} — PR closed/merged)`);
    const removed = await git(['worktree', 'remove', path], cwd);
    if (removed.code !== 0) {
      log(`  warning: could not remove ${path}: ${removed.stderr.trim()}`);
    } else {
      result.worktreesRemoved += 1;
    }
  }

  // Phase 2: delete branches.
  for (const branch of allBranches) {
    if (branch === currentBranch) {
      log(`Keeping  branch ${branch} (current branch)`);
      result.branchesKept += 1;
      continue;
    }
    const state = status.get(branch) ?? 'open';
    if (state !== 'closed') {
      log(`Keeping  branch ${branch} (${keepReason(state)})`);
      result.branchesKept += 1;
      continue;
    }
    log(`Deleting branch ${branch} (PR closed/merged)`);
    const deleted = await git(['branch', '-D', branch], cwd);
    if (deleted.code !== 0) {
      log(`  warning: could not delete ${branch}: ${deleted.stderr.trim()}`);
    } else {
      result.branchesDeleted += 1;
    }
  }

  // Phase 3: prune (always runs).
  await git(['worktree', 'prune'], cwd);

  log(
    `Done — removed ${result.worktreesRemoved} worktree(s) ` +
      `(kept ${result.worktreesKept}), deleted ${result.branchesDeleted} branch(es) ` +
      `(kept ${result.branchesKept}).`,
  );
  return result;
}

async function safeCurrentRepo(cwd: string | undefined): Promise<string | null> {
  try {
    const r = await boundedRun(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      { timeoutMs: GIT_TIMEOUT_MS, cwd },
    );
    if ((r.code ?? 1) !== 0) return null;
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}
